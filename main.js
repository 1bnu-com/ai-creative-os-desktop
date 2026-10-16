const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {createStore}=require('./storage');
const {createLogger}=require('./logger');
// Preserve v0.2's exact storage directory even if the Windows product name changes.
app.setPath('userData',path.join(app.getPath('appData'),'ai-creative-os-desktop'));
let win;
const log=createLogger(app.getPath('userData'));
process.on('uncaughtException',e=>log('error','uncaughtException: '+(e&&e.stack||e)));
process.on('unhandledRejection',e=>log('error','unhandledRejection: '+(e&&e.stack||e)));
// Only one window may write the database at a time.
const gotLock=app.requestSingleInstanceLock();
if(!gotLock){app.quit()}else{app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus()}})}
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
const store=createStore({dir:app.getPath('userData'),seed,log});
app.whenReady().then(()=>{
 if(!gotLock)return;
 log('info','Start v'+app.getVersion()+' data='+store.dbPath);
 try{store.migrate()}catch(e){log('error','Migrasi: '+e.message);dialog.showErrorBox('Migrasi data dibatalkan',e.message)}
 try{store.load();if(store.state.recoveredFrom)dialog.showMessageBox({type:'warning',title:'Data dipulihkan',message:'Database utama rusak dan sudah dipulihkan dari backup terakhir.',detail:store.state.recoveredFrom})}catch(e){dialog.showErrorBox('Data tidak bisa dibuka',e.message)}
 setupUpdater();
 ipcMain.handle('update:status',()=>updateState);
 ipcMain.handle('update:check',()=>checkUpdates());
 ipcMain.handle('update:download',async()=>{if(updateState.status!=='available')return updateState;await autoUpdater.downloadUpdate();return updateState});
 ipcMain.handle('update:install',()=>{if(updateState.status!=='downloaded')return false;autoUpdater.quitAndInstall(false,true);return true});
 ipcMain.handle('cloud:open',()=>{const url=process.env.CREATIVE_OS_CLOUD_URL;if(!url||!/^https:\/\/[^/]+/i.test(url))return {ok:false,message:'CREATIVE_OS_CLOUD_URL belum disetel ke alamat HTTPS.'};const u=new URL(url);const cloudWindow=new BrowserWindow({width:1350,height:850,backgroundColor:'#080f1f',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});cloudWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));cloudWindow.webContents.on('will-navigate',(e,target)=>{if(new URL(target).origin!==u.origin)e.preventDefault()});cloudWindow.loadURL(url);return {ok:true}});

 ipcMain.handle('db:load',()=>{if(store.state.readOnly)throw new Error(store.state.error);return store.load()});
 ipcMain.handle('db:save',(_,db)=>{try{return store.save(db)}catch(e){log('error','Simpan gagal: '+e.message);throw e}});
 ipcMain.handle('video:attach',async(_,id)=>{const res=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Video',extensions:['mp4','mov','m4v','webm']}]});if(res.canceled||!res.filePaths[0])return null;const source=res.filePaths[0];const dir=path.join(app.getPath('userData'),'media');fs.mkdirSync(dir,{recursive:true});const name=crypto.randomUUID()+path.extname(source).toLowerCase();fs.copyFileSync(source,path.join(dir,name));return 'media/'+name});
 ipcMain.handle('video:open',(_,file)=>{const resolved=store.resolveMedia(file);if(!resolved)throw Error('Invalid media path');if(!fs.existsSync(resolved))throw Error('File video tidak ditemukan. Restore backup lengkap yang berisi folder media.');return shell.openPath(resolved)});
 ipcMain.handle('db:export',async()=>{const r=await dialog.showOpenDialog(win,{title:'Pilih lokasi backup (folder baru akan dibuat)',properties:['openDirectory','createDirectory']});if(r.canceled||!r.filePaths[0])return false;const out=store.exportFull(r.filePaths[0]);shell.showItemInFolder(path.join(out.folder,'creative-os.json'));return true});
 ipcMain.handle('db:import',async()=>{const r=await dialog.showOpenDialog(win,{filters:[{name:'JSON',extensions:['json']}],properties:['openFile']});if(r.canceled)return null;return store.importFrom(r.filePaths[0])});
 win=new BrowserWindow({width:1440,height:900,minWidth:980,minHeight:670,backgroundColor:'#080f1f',webPreferences:{preload:path.join(__dirname,'preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true}});win.loadFile(path.join(__dirname,'index.html'));win.webContents.once('did-finish-load',()=>win.webContents.send('update:status',updateState));if(app.isPackaged&&isPublishConfigured())setTimeout(()=>checkUpdates(),5000);
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
