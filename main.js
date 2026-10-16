const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const fs=require('fs'),path=require('path'),crypto=require('crypto');
// Preserve v0.2's exact storage directory even if the Windows product name changes.
app.setPath('userData',path.join(app.getPath('appData'),'ai-creative-os-desktop'));
let win;
const {autoUpdater}=require('electron-updater');
let updateState={status:'idle',message:'Belum memeriksa pembaruan',version:app.getVersion()};
const isPublishConfigured=()=>{try{const p=require('./package.json').build.publish[0];return p.owner!=='SET_GITHUB_OWNER'&&p.repo!=='SET_GITHUB_REPO'}catch{return false}};
function publishState(status,message,extra={}){updateState={status,message,version:app.getVersion(),...extra};if(win&&!win.isDestroyed())win.webContents.send('update:status',updateState)}
async function checkUpdates(){
 if(!app.isPackaged){publishState('dev','Auto-update tersedia setelah aplikasi dibuat sebagai installer Windows.');return updateState}
 if(!isPublishConfigured()){publishState('unconfigured','GitHub release belum dikonfigurasi.');return updateState}
 publishState('checking','Memeriksa versi baru...');
 try{await autoUpdater.checkForUpdates();return updateState}catch(e){publishState('error','Pemeriksaan update gagal: '+e.message);return updateState}
}
function setupUpdater(){
 autoUpdater.autoDownload=false;autoUpdater.autoInstallOnAppQuit=false;
 autoUpdater.on('checking-for-update',()=>publishState('checking','Memeriksa versi baru...'));
 autoUpdater.on('update-available',i=>publishState('available','Versi '+i.version+' tersedia.',{newVersion:i.version}));
 autoUpdater.on('update-not-available',()=>publishState('current','Aplikasi sudah versi terbaru.'));
 autoUpdater.on('download-progress',p=>publishState('downloading','Mengunduh pembaruan: '+Math.round(p.percent)+'%',{percent:p.percent}));
 autoUpdater.on('update-downloaded',i=>publishState('downloaded','Update '+i.version+' siap dipasang setelah restart.',{newVersion:i.version}));
 autoUpdater.on('error',e=>publishState('error','Updater: '+e.message));
}

const seed=[
{id:'APR016',title:'Tanda-Tanda Menopause Dini',brand:'NOVIA',angle:'Gejala menopause dini',format:'Talking + B-Roll',formula:'Unverified',hook:'',character:'Alya',channel:'Meta Ads',category:'Winner',notes:'Ditandai Winner oleh pemilik. Detail script perlu transkripsi dan review.',avoid:false,video:'',script:'',factors:[],ratings:{},createdAt:'2026-10-15'},
{id:'MEI013',title:'Miss V Kering After Menopause',brand:'NOVIA',angle:'Miss V kering',format:'Educational Talking + B-Roll',formula:'Unverified',hook:'',character:'Sekar',channel:'Meta Ads',category:'Winner',notes:'Ditandai Winner oleh pemilik. Belum ada data metrik.',avoid:false,video:'',script:'',factors:[],ratings:{},createdAt:'2026-10-15'},
{id:'MEI016',title:'Menopause Itu Alami',brand:'NOVIA',angle:'Perubahan menopause',format:'Educational Talking + B-Roll',formula:'Unverified',hook:'',character:'Sekar',channel:'Meta Ads',category:'Winner',notes:'Ditandai Winner oleh pemilik. Perlu verifikasi naskah.',avoid:false,video:'',script:'',factors:[],ratings:{},createdAt:'2026-10-15'},
{id:'JULI020',title:'Hasil Konsumsi NOVIA',brand:'NOVIA',angle:'Pengalaman penggunaan',format:'Personal Story',formula:'Unverified',hook:'',character:'Clara',channel:'Meta Ads',category:'Winner',notes:'Ditandai Winner oleh pemilik. Klaim testimoni memerlukan verifikasi.',avoid:false,video:'',script:'',factors:[],ratings:{},createdAt:'2026-10-15'},
{id:'SEPT010',title:'Alasan Payudara Kendur',brand:'NOVIA',angle:'Perubahan payudara',format:'Educational Talking',formula:'Unverified',hook:'',character:'Sekar',channel:'Meta Ads',category:'Winner',notes:'Ditandai Winner oleh pemilik. Hook verbatim belum ditranskrip.',avoid:false,video:'',script:'',factors:[],ratings:{},createdAt:'2026-10-15'}];
function dbPath(){return path.join(app.getPath('userData'),'creative-os.json')}
function migrateSafely(){
 const file=dbPath();if(!fs.existsSync(file))return;
 const original=fs.readFileSync(file,'utf8');let data;try{data=JSON.parse(original)}catch{throw Error('Database tidak valid; migrasi dibatalkan, file asli dipertahankan.')}
 if(!data||!Array.isArray(data.projects))throw Error('Database tidak memiliki projects; migrasi dibatalkan.');
 if((data.schemaVersion||1)>=2)return;
 const backupDir=path.join(app.getPath('userData'),'migration-backups');fs.mkdirSync(backupDir,{recursive:true});
 const backup=path.join(backupDir,'creative-os-v0.2-before-v0.3-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
 fs.writeFileSync(backup,original,{flag:'wx'});
 const migrated={...data,schemaVersion:2,migrationHistory:[...(data.migrationHistory||[]),{to:2,date:new Date().toISOString(),backup}]};
 // backup must be written and checked BEFORE replacing existing database
 if(JSON.parse(fs.readFileSync(backup,'utf8')).projects.length!==data.projects.length)throw Error('Validasi backup gagal');
 save(migrated);
}
function load(){try{return JSON.parse(fs.readFileSync(dbPath(),'utf8'))}catch{return {version:1,projects:seed,insights:[],preferences:{brand:'NOVIA'}}}}
function save(db){const f=dbPath();fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f+'.tmp',JSON.stringify(db,null,2));fs.renameSync(f+'.tmp',f);return true}
function safeProject(p){const o={};for(const k of ['id','title','brand','angle','format','formula','hook','character','channel','category','notes','avoid','script','factors','ratings','createdAt','video','reviewHistory','scriptVersions','targetAudience','cta','duration','finalLink','publishDate','feedbackRules'])if(Object.prototype.hasOwnProperty.call(p,k))o[k]=p[k];if(!['Winner','Potential','Underperform',''].includes(o.category))o.category='';o.id=String(o.id||crypto.randomUUID());return o}
app.whenReady().then(()=>{
 try{migrateSafely()}catch(e){dialog.showErrorBox('Migrasi data dibatalkan',e.message)}
 setupUpdater();
 ipcMain.handle('update:status',()=>updateState);
 ipcMain.handle('update:check',()=>checkUpdates());
 ipcMain.handle('update:download',async()=>{if(updateState.status!=='available')return updateState;await autoUpdater.downloadUpdate();return updateState});
 ipcMain.handle('update:install',()=>{if(updateState.status!=='downloaded')return false;autoUpdater.quitAndInstall(false,true);return true});
 ipcMain.handle('cloud:open',()=>{const url=process.env.CREATIVE_OS_CLOUD_URL;if(!url||!/^https:\/\/[^/]+/i.test(url))return {ok:false,message:'CREATIVE_OS_CLOUD_URL belum disetel ke alamat HTTPS.'};const u=new URL(url);const cloudWindow=new BrowserWindow({width:1350,height:850,backgroundColor:'#080f1f',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});cloudWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));cloudWindow.webContents.on('will-navigate',(e,target)=>{if(new URL(target).origin!==u.origin)e.preventDefault()});cloudWindow.loadURL(url);return {ok:true}});

 ipcMain.handle('db:load',()=>load());
 ipcMain.handle('db:save',(_,db)=>{if(!db||!Array.isArray(db.projects))throw Error('Invalid data');db.projects=db.projects.map(safeProject);return save(db)});
 ipcMain.handle('video:attach',async(_,id)=>{const res=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Video',extensions:['mp4','mov','m4v','webm']}]});if(res.canceled||!res.filePaths[0])return null;const source=res.filePaths[0];const dir=path.join(app.getPath('userData'),'media');fs.mkdirSync(dir,{recursive:true});const dest=path.join(dir,crypto.randomUUID()+path.extname(source).toLowerCase());fs.copyFileSync(source,dest);return dest});
 ipcMain.handle('video:open',(_,file)=>{const base=path.resolve(app.getPath('userData'),'media');const resolved=path.resolve(String(file||''));if(!resolved.startsWith(base+path.sep))throw Error('Invalid media path');return shell.openPath(resolved)});
 ipcMain.handle('db:export',async()=>{const result=await dialog.showSaveDialog(win,{defaultPath:'creative-os-backup.json',filters:[{name:'JSON',extensions:['json']}]});if(result.canceled)return false;fs.writeFileSync(result.filePath,JSON.stringify(load(),null,2));return true});
 ipcMain.handle('db:import',async()=>{const r=await dialog.showOpenDialog(win,{filters:[{name:'JSON',extensions:['json']}],properties:['openFile']});if(r.canceled)return null;const imported=JSON.parse(fs.readFileSync(r.filePaths[0],'utf8'));if(!Array.isArray(imported.projects))throw Error('Invalid backup');imported.projects=imported.projects.map(safeProject);save(imported);return imported});
 win=new BrowserWindow({width:1440,height:900,minWidth:980,minHeight:670,backgroundColor:'#080f1f',webPreferences:{preload:path.join(__dirname,'preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true}});win.loadFile(path.join(__dirname,'index.html'));win.webContents.once('did-finish-load',()=>win.webContents.send('update:status',updateState));if(app.isPackaged&&isPublishConfigured())setTimeout(()=>checkUpdates(),5000);
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
