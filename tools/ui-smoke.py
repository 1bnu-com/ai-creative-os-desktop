"""UI smoke test for the renderer (index.html + app.js) in headless Chromium.

Runs the real page with the same file:// origin and CSP as Electron, but with a
fake window.desktopAPI (in-memory data). Usage:  python3 tools/ui-smoke.py [screenshot_dir]
Requires: pip install playwright && playwright install chromium
"""
import json, pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None

FAKE_API = """
(() => {
  const winners = ['APR016','MEI013','MEI016','JULI020','SEPT010'].map((id,i)=>({id,title:'Winner '+id,brand:'NOVIA',angle:'Menopause',format:'Talking + B-Roll',formula:'Unverified',hook:'',character:i%2?'Sekar':'Clara',channel:'Meta Ads',category:'Winner',notes:'Ditandai Winner oleh pemilik.',avoid:false,video:'',script:'',factors:[],ratings:{},createdAt:'2026-10-15'}));
  window.__db = {schemaVersion:2, projects: winners, insights:[], preferences:{brand:'NOVIA'}};
  window.__calls = [];
  const clone = x => JSON.parse(JSON.stringify(x));
  window.desktopAPI = {
    load: async () => clone(window.__db),
    save: async db => { window.__calls.push('save'); window.__db = clone(db); return true; },
    attach: async () => 'media/test.mp4',
    openVideo: async () => '',
    exportBackup: async () => { window.__calls.push('export'); return true; },
    importBackup: async () => { window.__calls.push('import'); return clone(window.__db); },
    getUpdateStatus: async () => ({status:'dev', message:'Auto-update tersedia setelah aplikasi dibuat sebagai installer Windows.'}),
    checkUpdate: async () => ({status:'dev'}), downloadUpdate: async () => ({}), installUpdate: async () => false,
    onUpdate: () => () => {}, openCloud: async () => ({ok:false, message:'belum disetel'}),
  };
})();
"""

def main():
    problems = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        page.add_init_script(FAKE_API)
        page.on('console', lambda m: m.type in ('error', 'warning') and problems.append(f'console {m.type}: {m.text}'))
        page.on('pageerror', lambda e: problems.append(f'pageerror: {e}'))
        page.on('dialog', lambda d: d.accept())
        page.goto((ROOT / 'index.html').as_uri())

        def shot(name):
            if SHOTS:
                SHOTS.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(SHOTS / f'{name}.png'), full_page=True)

        def nav(name):
            page.click(f'[data-nav="{name}"]')

        def db():
            return page.evaluate('window.__db')

        def check(cond, msg):
            if not cond: problems.append('FAIL: ' + msg)
            print(('ok  ' if cond else 'FAIL') + ' ' + msg)

        check(page.inner_text('h1') == 'Creative Command Center', 'Dashboard terbuka')
        check('5' in page.inner_text('.metric:first-child strong'), 'Dashboard menghitung 5 Winner')
        shot('1-dashboard')

        nav('Projects')
        check(page.locator('#projectList .project-row').count() == 5, 'Projects menampilkan 5 project')
        page.fill('#projectSearch', 'sekar')
        check(page.locator('#projectList .project-row').count() == 2, 'Pencarian karakter bekerja')
        page.fill('#projectSearch', '')
        shot('2-projects')

        page.click('#newProject')
        check(page.inner_text('h1') == 'Manual Creative Review', 'Project baru membuka halaman Review')
        page.fill('[data-field="title"]', 'Tes Project Baru')
        page.click('[data-status="Potential"]')
        page.check('[data-factor="Hook"]')
        page.fill('#reviewNotes', 'Hook kuat, CTA lemah')
        page.click('#saveReview')
        page.wait_for_timeout(200)
        d = db()
        np = d['projects'][0]
        check(len(d['projects']) == 6, 'Project baru tersimpan (6 project)')
        check(np['category'] == 'Potential' and np['title'] == 'Tes Project Baru', 'Label manual Potential tersimpan')
        check(len(np.get('reviewHistory', [])) == 1 and np.get('reviewedAt'), 'Riwayat review + tanggal review tersimpan')
        check([p['category'] for p in d['projects']].count('Winner') == 5, '5 Winner tidak berubah')
        page.click('#attachVideo'); page.wait_for_timeout(200)
        check(db()['projects'][0]['video'] == 'media/test.mp4', 'Lampiran video tersimpan sebagai path relatif')
        page.click('#openVideo'); page.wait_for_timeout(100)
        shot('3-review')

        nav('Learning')
        check('Tes Project Baru' in page.inner_text('#root'), 'Learning menampilkan project Potential')
        shot('4-learning')

        nav('Script Builder')
        page.click('#generate')
        draft = page.input_value('#draft')
        check(len(draft) > 100 and 'HOOK' in draft, 'Script Builder membuat draft')
        page.click('#saveAsProject'); page.wait_for_timeout(200)
        d = db()
        check(len(d['projects']) == 7 and d['projects'][0]['category'] == '', 'Script tersimpan sebagai project tanpa label')
        check(len(d['projects'][0].get('scriptVersions', [])) == 1, 'Versi script pertama tersimpan')

        # Mark that project Underperform + do-not-repeat, then try to save the same script again.
        page.click('[data-status="Underperform"]')
        page.check('#avoidPattern')
        page.click('#saveReview'); page.wait_for_timeout(200)
        nav('Script Builder')
        page.click('#generate')
        check('Do Not Repeat' in page.inner_text('#scriptDiagnostics'), 'Peringatan Do Not Repeat muncul untuk script mirip')
        before = len(db()['projects'])
        page.click('#saveAsProject'); page.wait_for_timeout(200)
        check(len(db()['projects']) == before, 'Script yang terlalu mirip tidak tersimpan')
        shot('5-script-builder')

        page.click('#backupButton'); page.wait_for_timeout(100)
        page.click('#restoreButton'); page.wait_for_timeout(200)
        calls = page.evaluate('window.__calls')
        check('export' in calls and 'import' in calls, 'Tombol Backup dan Restore memanggil desktop API')
        check('Auto-update' in page.inner_text('#updateState'), 'Status update tampil (mode dev)')
        browser.close()

    bad = [x for x in problems if not x.startswith('FAIL')]
    for x in bad: print('ERR ', x)
    print('\nRESULT:', 'PASS' if not problems else f'{len(problems)} problem(s)')
    sys.exit(1 if problems else 0)

if __name__ == '__main__':
    main()
