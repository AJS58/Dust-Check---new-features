
function generateHeatMapCanvas(){
  const hc=document.createElement('canvas');
  hc.width=canvas.width;
  hc.height=canvas.height;
  const hctx=hc.getContext('2d');

  hctx.drawImage(img,0,0,hc.width,hc.height);
  hctx.globalAlpha=0.45;

  [...spots,...oilSpots,...gritSpots,...manualSpots].forEach((s)=>{
    const radius=Math.max(40,s.r*6);
    const g=hctx.createRadialGradient(s.x,s.y,0,s.x,s.y,radius);

    let color='rgba(0,180,255,0.7)';
    if(s.grit) color='rgba(126,44,255,0.95)';
    else if(s.oil) color='rgba(255,153,0,0.95)';
    else if((s.area||0)>900) color='rgba(255,0,0,0.9)';
    else if((s.area||0)>140) color='rgba(255,140,0,0.8)';
    else color='rgba(255,230,0,0.7)';

    g.addColorStop(0,color);
    g.addColorStop(1,'rgba(255,255,255,0)');

    hctx.fillStyle=g;
    hctx.beginPath();
    hctx.arc(s.x,s.y,radius,0,Math.PI*2);
    hctx.fill();
  });

  return hc.toDataURL('image/png');
}

function updateCompareSlider(){
  const slider=document.getElementById('compareSlider');
  const wrap=document.getElementById('compareAfterWrap');
  if(!slider||!wrap) return;
  wrap.style.width=slider.value+'%';
}

function escapeHtml(value){
  return String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
const $ = id => document.getElementById(id);
const canvas = $('mainCanvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const loupe = $('loupe');
const loupeCanvas = $('loupeCanvas');
const loupeCtx = loupeCanvas ? loupeCanvas.getContext('2d') : null;
let img = new Image();
let originalData = null;
let cleanData = null;
let spots = [];
let oilSpots = [];
let gritSpots = [];
let manualSpots = [];
let overlay = true;
let cleanMode = false;
let scale = 1;
let currentFileName = '';
let currentMetadata = {};
let batchFiles = [];
let batchItems = [];
let lastBatchSummary = null;

let paid = false;
let activeTool = 'pan';
let enlargeMode = false;

const els = ['detectBtn','cleanupBtn','saveBtn','toggleOverlay','toggleClean'];
function setEnabled(enabled){ els.forEach(id => $(id).disabled = !enabled); $('reportBtn').disabled = !(enabled && paid); }
function setPaid(v){ paid = v; const rb=$('reportBtn'); if(rb) rb.disabled = !(v && originalData); }
$('paidToggle').addEventListener('change', e => setPaid(e.target.checked));
$('unlockBtn').addEventListener('click', () => { $('paidToggle').checked = true; setPaid(true); alert('Demo unlock enabled. In the live version this button would connect to Stripe/PayPal payment for the £6.99 report.'); });
$('sensitivity').addEventListener('input', e => $('sensValue').textContent=e.target.value);
$('minSize').addEventListener('input', e => $('sizeValue').textContent=e.target.value);


function formatExifRational(value){
  if(value === undefined || value === null) return '';
  if(typeof value === 'number') return value;
  if(value && typeof value.n === 'number' && typeof value.d === 'number') return value.d ? value.n/value.d : 0;
  return value;
}
function formatShutter(v){
  const n = formatExifRational(v);
  if(!n) return '–';
  if(n >= 1) return `${Number(n).toFixed(n>=10?0:1)}s`;
  return `1/${Math.round(1/n)}s`;
}
function formatAperture(v){
  const n = formatExifRational(v);
  return n ? `f/${Number(n).toFixed(n % 1 ? 1 : 0)}` : '–';
}
function formatFocal(v){
  const n = formatExifRational(v);
  return n ? `${Number(n).toFixed(n % 1 ? 1 : 0)}mm` : '';
}
function readAscii(view, offset, count){
  let s='';
  for(let i=0;i<count;i++){
    const c=view.getUint8(offset+i);
    if(c===0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}
function parseExifBuffer(buffer){
  const view = new DataView(buffer);
  let offset = 2; // after SOI
  while(offset < view.byteLength-4){
    if(view.getUint8(offset) !== 0xFF) break;
    const marker = view.getUint8(offset+1);
    const length = view.getUint16(offset+2, false);
    if(marker === 0xE1){
      const header = readAscii(view, offset+4, 6);
      if(header !== 'Exif') { offset += 2 + length; continue; }
      const tiff = offset + 10;
      const little = readAscii(view,tiff,2) === 'II';
      const get16=(o)=>view.getUint16(o,little);
      const get32=(o)=>view.getUint32(o,little);
      const firstIFD = tiff + get32(tiff+4);
      const tags = {};
      function valueOf(entry){
        const tag=get16(entry), type=get16(entry+2), count=get32(entry+4);
        const valOff=entry+8;
        const typeSize={1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8}[type] || 1;
        const bytes=typeSize*count;
        const valueOffset = bytes<=4 ? valOff : tiff + get32(valOff);
        try{
          if(type===2) return readAscii(view,valueOffset,count);
          if(type===3) return count===1 ? get16(valueOffset) : Array.from({length:count},(_,i)=>get16(valueOffset+i*2));
          if(type===4) return count===1 ? get32(valueOffset) : Array.from({length:count},(_,i)=>get32(valueOffset+i*4));
          if(type===5) return {n:get32(valueOffset), d:get32(valueOffset+4)};
          if(type===9) return view.getInt32(valueOffset,little);
          if(type===10) return {n:view.getInt32(valueOffset,little), d:view.getInt32(valueOffset+4,little)};
          return null;
        }catch(e){ return null; }
      }
      function readIFD(ifd){
        const out={};
        const entries=get16(ifd);
        for(let i=0;i<entries;i++){
          const entry=ifd+2+i*12;
          const tag=get16(entry);
          out[tag]=valueOf(entry);
        }
        return out;
      }
      const ifd0=readIFD(firstIFD);
      let exif={};
      if(ifd0[0x8769]) exif=readIFD(tiff + ifd0[0x8769]);
      return {
        make: ifd0[0x010F] || '',
        model: ifd0[0x0110] || '',
        lens: exif[0xA434] || exif[0xA432] || '',
        aperture: exif[0x829D] || exif[0x9202] || '',
        shutter: exif[0x829A] || '',
        iso: exif[0x8827] || exif[0x8833] || '',
        focal: exif[0x920A] || '',
        date: exif[0x9003] || exif[0x9004] || ifd0[0x0132] || ''
      };
    }
    offset += 2 + length;
  }
  return {};
}
async function extractImageMetadata(file){
  try{
    const buffer = await file.arrayBuffer();
    currentMetadata = parseExifBuffer(buffer) || {};
  }catch(e){ currentMetadata = {}; }
  updateMetadataPanel();
}
function updateMetadataPanel(){
  const p=$('metadataPanel');
  if(!p) return;
  p.hidden=false;
  const camera = [currentMetadata.make, currentMetadata.model].filter(Boolean).join(' ') || '–';
  const lensText = currentMetadata.lens ? String(currentMetadata.lens) : (formatFocal(currentMetadata.focal) || '–');
  if($('metaAperture')) $('metaAperture').textContent = formatAperture(currentMetadata.aperture);
  if($('metaShutter')) $('metaShutter').textContent = formatShutter(currentMetadata.shutter);
  if($('metaISO')) $('metaISO').textContent = currentMetadata.iso || '–';
  if($('metaCamera')) $('metaCamera').textContent = camera;
  if($('metaLens')) $('metaLens').textContent = lensText;
  if($('metaDate')) $('metaDate').textContent = currentMetadata.date || '–';
}

$('fileInput').addEventListener('change', async e => {
  const files = Array.from(e.target.files || []);
  if(!files.length) return;
  const bad = files.find(file => !(file.type === 'image/jpeg' || /\.(jpe?g)$/i.test(file.name || '')));
  if(bad){
    alert('This version accepts JPEG files only. Please export JPEG dust-test images and upload those files.');
    e.target.value = '';
    return;
  }

  batchFiles = files;
  await prepareBatchList(files);

  const file = files[0];
  currentFileName = file.name;
  await extractImageMetadata(file);
  const url = URL.createObjectURL(file);
  img.onload = () => { URL.revokeObjectURL(url); loadImageToCanvas(); };
  img.src = url;
});


async function prepareBatchList(files){
  batchItems = [];
  const panel=$('batchPanel'), list=$('batchList'), btn=$('batchAnalyseBtn'), result=$('batchResult');
  if(panel) panel.hidden = files.length < 2;
  if(result){ result.hidden=true; result.innerHTML=''; }
  if(!list || !btn) return;

  list.innerHTML = '';
  for(const file of files){
    let md={};
    try{ md = parseExifBuffer(await file.arrayBuffer()) || {}; }catch(e){ md={}; }
    const aperture = formatAperture(md.aperture);
    batchItems.push({file, metadata:md, aperture});
    const div=document.createElement('div');
    div.className='batchItem';
    div.innerHTML=`<div><strong>${escapeHtml(file.name)}</strong><span>Aperture: ${escapeHtml(aperture)} · ISO: ${escapeHtml(md.iso || '–')}</span></div><span>${Math.round(file.size/1024)} KB</span>`;
    list.appendChild(div);
  }
  btn.disabled = files.length < 2;
}

function loadImageFromFile(file){
  return new Promise((resolve,reject)=>{
    const im=new Image();
    const url=URL.createObjectURL(file);
    im.onload=()=>{URL.revokeObjectURL(url); resolve(im);};
    im.onerror=()=>{URL.revokeObjectURL(url); reject(new Error('Image failed to load'));};
    im.src=url;
  });
}

function quickAnalyseImage(im, maxSide=900){
  const c=document.createElement('canvas');
  const r=Math.min(1,maxSide/Math.max(im.naturalWidth,im.naturalHeight));
  c.width=Math.max(1,Math.round(im.naturalWidth*r));
  c.height=Math.max(1,Math.round(im.naturalHeight*r));
  const cctx=c.getContext('2d');
  cctx.drawImage(im,0,0,c.width,c.height);
  const id=cctx.getImageData(0,0,c.width,c.height);
  const data=id.data,w=c.width,h=c.height;
  const gray=new Uint8ClampedArray(w*h);
  for(let i=0,p=0;i<data.length;i+=4,p++) gray[p]=Math.round(data[i]*.299+data[i+1]*.587+data[i+2]*.114);

  const small=boxBlur(gray,w,h,9), large=boxBlur(gray,w,h,35);
  const mask=new Uint8Array(w*h);
  for(let p=0;p<mask.length;p++){
    const d=large[p]-small[p];
    if(d>7) mask[p]=1;
  }
  const comps=connectedComponents(mask,w,h,4,w*h).filter(c=>c.area>=4 && c.area<5000);
  const oil=detectLargeTranslucentOilPass(gray,w,h,[], 'batch', 90);
  return {
    width:w,height:h,
    dust:comps.map(c=>({x:c.cx,y:c.cy,r:Math.max(3,Math.sqrt(c.area/Math.PI)),area:c.area})),
    oil,
    total:comps.length+oil.length
  };
}

function normaliseMarks(marks,w,h){
  return marks.map(m=>({x:m.x/w,y:m.y/h,r:m.r/Math.max(w,h),oil:!!m.oil,area:m.area||0}));
}

function compareFixedMarks(analyses){
  const all=analyses.map(a=>normaliseMarks([...(a.analysis.dust||[]),...(a.analysis.oil||[])],a.analysis.width,a.analysis.height));
  if(all.length<2) return {matched:0,confidence:'Insufficient images'};
  const base=all[0];
  let matched=0;
  for(const m of base){
    let seen=1;
    for(let i=1;i<all.length;i++){
      if(all[i].some(o=>Math.hypot(o.x-m.x,o.y-m.y)<0.018)) seen++;
    }
    if(seen>=Math.ceil(all.length*0.66)) matched++;
  }
  const conf = matched>=8 ? 'High fixed-position contamination confidence' : matched>=3 ? 'Medium fixed-position contamination confidence' : matched>0 ? 'Low fixed-position contamination confidence' : 'No fixed-position match found';
  return {matched,confidence:conf};
}

async function runBatchAnalysis(){
  const result=$('batchResult');
  if(!batchFiles || batchFiles.length<2) return alert('Please upload two or more JPEG test images first.');
  if(result){ result.hidden=false; result.innerHTML='Analysing batch…'; }
  const analyses=[];
  for(const item of batchItems){
    const im=await loadImageFromFile(item.file);
    const analysis=quickAnalyseImage(im);
    analyses.push({...item, analysis});
  }
  const fixed=compareFixedMarks(analyses);
  lastBatchSummary = {analyses,fixed};
  const rows=analyses.map(a=>`<div><b>${escapeHtml(a.aperture)}</b> — ${escapeHtml(a.file.name)}: ${a.analysis.total} indicators (${a.analysis.oil.length} possible oil/halo)</div>`).join('');
  if(result){
    result.innerHTML=`<strong>Multi-aperture result:</strong><br>${rows}<br><b>${fixed.confidence}</b><br>Fixed-position matches across apertures: ${fixed.matched}<br><span>This comparison helps separate true sensor contamination from clouds/background texture because real sensor marks stay in the same position.</span>`;
  }
  updateResults(summary());
}

function loadImageToCanvas(){
  const maxSide = 1800;
  let w = img.naturalWidth, h = img.naturalHeight;
  const r = Math.min(1, maxSide / Math.max(w,h));
  canvas.width = Math.round(w*r); canvas.height = Math.round(h*r);
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  originalData = ctx.getImageData(0,0,canvas.width,canvas.height);
  cleanData = null; spots=[]; oilSpots=[]; gritSpots=[]; manualSpots=[]; scale=1; cleanMode=false; overlay=true;
  $('emptyState').style.display='none'; $('fileSummary').innerHTML = `<strong>${escapeHtml(currentFileName)}</strong><span>JPEG loaded — ${canvas.width} × ${canvas.height}px analysis preview</span>`; setEnabled(true); fitCanvas(); runDetection();
}

$('detectBtn').addEventListener('click', runDetection);

$('saveBtn').addEventListener('click', saveAnnotated);
$('toggleOverlay').addEventListener('click', ()=>{overlay=!overlay; cleanMode=false; render();});
$('viewOriginal').addEventListener('click', ()=>{overlay=false; cleanMode=false; render();});
/* clean view handler attached below */
/* report handler attached after generateReportWindow is defined */
$('zoomIn').addEventListener('click', ()=>{scale=Math.min(4,scale*1.2); applyScale();});
$('zoomOut').addEventListener('click', ()=>{scale=Math.max(.15,scale/1.2); applyScale();});
$('fitBtn').addEventListener('click', fitCanvas);
$('enlargeBtn').addEventListener('click', ()=>{
  if(!originalData) return alert('Please upload an image first.');
  enlargeMode=!enlargeMode;
  $('canvasWrap').classList.toggle('enlargeMode', enlargeMode);
  $('enlargeBtn').classList.toggle('active', enlargeMode);

  if(enlargeMode){
    // Enlarge is now an inspection tool: move or click on the image to inspect that area.
    updateLoupe(canvas.width/2, canvas.height/2, null);
  } else {
    if(loupe) loupe.hidden=true;
  }
});
$('resetBtn').addEventListener('click', ()=>{ if(originalData){spots=[];manualSpots=[];cleanData=null;cleanMode=false;overlay=true;ctx.putImageData(originalData,0,0);updateResults(null);} });
$('clearManual').addEventListener('click', ()=>{manualSpots=[]; render(); updateResults(summary());});
document.querySelectorAll('.tool').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tool').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeTool=b.dataset.tool; const wrap=$('canvasWrap'); wrap.classList.toggle('markMode',activeTool==='mark'); wrap.classList.toggle('eraseMode',activeTool==='erase');}));
document.querySelectorAll('.mode').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.mode').forEach(x=>x.classList.remove('active'));b.classList.add('active'); if(originalData) runDetection();}));

canvas.addEventListener('click', e=>{
  if(!originalData) return;
  const rect=canvas.getBoundingClientRect();
  const x=(e.clientX-rect.left)*(canvas.width/rect.width);
  const y=(e.clientY-rect.top)*(canvas.height/rect.height);

  if(enlargeMode){
    updateLoupe(x,y,e);
    return;
  }

  if(activeTool==='pan') return;
  if(activeTool==='mark') manualSpots.push({x,y,r:16,area:800,manual:true});
  if(activeTool==='erase'){
    eraseAt(x,y);
  }

  if(strength >= 92 && minArea <= 6 && (mode.includes('high') || mode.includes('aggressive'))){
    const combined=[...spots];
    if(typeof oilSpots !== 'undefined') combined.push(...oilSpots);
    if(typeof gritSpots !== 'undefined') combined.push(...gritSpots);
    spots = [...spots, ...microSpotBoost(gray,w,h,combined)];
  }


  // Dedicated oil/grease halo pass for translucent circular “fried egg” marks.
  if(strength >= 70 && (mode.includes('high') || mode.includes('aggressive'))){
    const existing=[...spots,...oilSpots,...gritSpots];
    const haloOil=detectOilHaloPass(gray,w,h,existing,mode,strength);
    oilSpots = [...oilSpots, ...haloOil];
    const largeHaloOil=detectLargeTranslucentOilPass(gray,w,h,[...spots,...oilSpots,...gritSpots],mode,strength);
    oilSpots = [...oilSpots, ...largeHaloOil];
  }

  // Faint-dust fallback: prevents a false clean result where manual inspection shows low-contrast dust.
  if((spots.length + oilSpots.length + gritSpots.length) <= 2 && strength >= 85 && (mode.includes('high') || mode.includes('aggressive'))){
    const existing=[...spots,...oilSpots,...gritSpots];
    spots = [...spots, ...faintDustFallback(gray,w,h,existing,mode,strength,minArea)];
  }

  render(); updateResults(summary());
});

canvas.addEventListener('mousemove', e=>{
  if(!originalData) return;
  const rect=canvas.getBoundingClientRect();
  const x=(e.clientX-rect.left)*(canvas.width/rect.width);
  const y=(e.clientY-rect.top)*(canvas.height/rect.height);

  if(enlargeMode){
    updateLoupe(x,y,e);
  }
});
canvas.addEventListener('mouseleave', ()=>{ if(loupe && !enlargeMode) loupe.hidden=true; });

function eraseAt(x,y){
  const eraseRadius = Math.max(34, canvas.width/42); // wider hit area so the tool feels reliable
  let removed = 0;
  const keep = s => {
    const d = Math.hypot(s.x-x,s.y-y);
    const threshold = Math.max(eraseRadius, (s.r||0)+22);
    const shouldRemove = d > threshold;
    if(!shouldRemove) removed++;
    return shouldRemove;
  };
  spots = spots.filter(keep);
  manualSpots = manualSpots.filter(keep);
  // Fallback: if the click was close but missed the wider threshold, remove the nearest spot.
  if(!removed){
    const all = [...spots.map((s,i)=>({s,i,list:'spots',d:Math.hypot(s.x-x,s.y-y)})), ...manualSpots.map((s,i)=>({s,i,list:'manual',d:Math.hypot(s.x-x,s.y-y)}))].sort((a,b)=>a.d-b.d);
    if(all[0] && all[0].d < eraseRadius*1.8){
      if(all[0].list==='spots') spots.splice(all[0].i,1); else manualSpots.splice(all[0].i,1);
    }
  }
}

function updateLoupe(x,y,e){
  if(!loupe || !loupeCtx || !originalData) return;
  const sourceSize = Math.max(70, Math.round(Math.min(canvas.width, canvas.height) / 7));
  const sx = Math.max(0, Math.min(canvas.width-sourceSize, x-sourceSize/2));
  const sy = Math.max(0, Math.min(canvas.height-sourceSize, y-sourceSize/2));

  loupeCtx.clearRect(0,0,loupeCanvas.width,loupeCanvas.height);
  loupeCtx.imageSmoothingEnabled = true;
  loupeCtx.drawImage(
    canvas,
    sx, sy,
    sourceSize,
    sourceSize*(loupeCanvas.height/loupeCanvas.width),
    0, 0,
    loupeCanvas.width,
    loupeCanvas.height
  );

  loupe.hidden=false;

  const wrap = $('canvasWrap').getBoundingClientRect();

  // Fixed lower-left placement keeps the loupe usable and prevents it disappearing off-screen.
  // It mirrors the earlier "image within image" behaviour.
  let lx = 26;
  let ly = Math.max(20, wrap.height - 170);

  // If the selected area is near the lower-left, place the loupe upper-right instead.
  const displayX = x * (parseFloat(canvas.style.width || canvas.width) / canvas.width);
  const displayY = y * (parseFloat(canvas.style.height || canvas.height) / canvas.height);
  if(displayX < 260 && displayY > wrap.height - 260){
    lx = Math.max(20, wrap.width - 230);
    ly = 26;
  }

  loupe.style.left = lx + 'px';
  loupe.style.top = ly + 'px';
  loupe.style.bottom = 'auto';
}



function medianOfFast(arr){
  if(!arr.length) return 0;
  const a=[...arr].sort((x,y)=>x-y);
  return a[Math.floor(a.length/2)];
}

function getPatchStats(gray,w,h,cx,cy,r){
  const vals=[];
  for(let yy=Math.max(0,cy-r); yy<=Math.min(h-1,cy+r); yy+=2){
    for(let xx=Math.max(0,cx-r); xx<=Math.min(w-1,cx+r); xx+=2){
      if(Math.hypot(xx-cx,yy-cy)<=r) vals.push(gray[yy*w+xx]);
    }
  }
  if(!vals.length) return {min:0,max:0,med:0,range:0};
  const min=Math.min(...vals), max=Math.max(...vals), med=medianOfFast(vals);
  return {min,max,med,range:max-min};
}

function classifyComponentFast(s, gray, w, h){
  const maxDim=Math.max(s.bw||0,s.bh||0);
  const minDim=Math.max(1,Math.min(s.bw||1,s.bh||1));
  const aspect=maxDim/minDim;
  const compactness=(s.area||1)/Math.max(1,(s.bw||1)*(s.bh||1));
  const cx=Math.round(s.x), cy=Math.round(s.y);
  const inner=getPatchStats(gray,w,h,cx,cy,Math.max(3,Math.round(maxDim*0.45)));
  const outer=getPatchStats(gray,w,h,cx,cy,Math.max(8,Math.round(maxDim*1.7)));

  const localContrast=outer.med-inner.med;
  const hardRange=outer.range;

  // Lightweight oil/grease indicator:
  // roundish/soft larger marks with centre/outer tonal difference.
  const possibleOil =
    maxDim>=16 &&
    maxDim<=Math.min(w,h)*0.065 &&
    aspect<1.75 &&
    compactness>0.42 &&
    compactness<0.84 &&
    localContrast>12 &&
    hardRange>22 &&
    hardRange<72 &&
    (s.area||0)>125;

  // Lightweight grit/sand indicator:
  // high-contrast, irregular, hard-edged or granular larger particles.
  const possibleGrit =
    maxDim>=9 &&
    maxDim<=Math.min(w,h)*0.075 &&
    aspect<3.4 &&
    hardRange>48 &&
    ((s.area||0)>130 || compactness<0.58) &&
    localContrast>15;

  if(possibleGrit) return 'grit';
  if(possibleOil) return 'oil';
  return 'dust';
}

function getDustOverlayColour(){
  const hidden=document.getElementById('highlightColour');
  return hidden ? hidden.value : '#00a7ff';
}


function microSpotBoost(gray,w,h,existing){
  // Lightweight second-pass detector for very small, low-contrast dust marks.
  // Only intended for maximum sensitivity settings.
  const out=[];
  const occupied=(x,y,r=8)=>existing.some(s=>Math.hypot(s.x-x,s.y-y)<Math.max(r,s.r||4)*1.4);

  for(let y=5;y<h-5;y+=2){
    for(let x=5;x<w-5;x+=2){
      if(occupied(x,y,7)) continue;

      const centre=gray[y*w+x];
      let ringSum=0, ringN=0;

      for(let yy=-4; yy<=4; yy++){
        for(let xx=-4; xx<=4; xx++){
          const d=Math.hypot(xx,yy);
          if(d>=3 && d<=4.5){
            ringSum += gray[(y+yy)*w+(x+xx)];
            ringN++;
          }
        }
      }

      if(!ringN) continue;

      const ring=ringSum/ringN;
      const diff=ring-centre;

      const n1=gray[(y-1)*w+x];
      const n2=gray[(y+1)*w+x];
      const n3=gray[y*w+x-1];
      const n4=gray[y*w+x+1];
      const neighbourAvg=(n1+n2+n3+n4)/4;
      const pixelSpike=Math.abs(centre-neighbourAvg);

      if(diff>5.5 && pixelSpike<18){
        out.push({x,y,r:4.5,area:24,bw:5,bh:5,elong:1,micro:true});
      }
    }
  }

  const final=[];
  for(const c of out){
    if(!final.some(o=>Math.hypot(o.x-c.x,o.y-c.y)<7)){
      final.push(c);
      if(final.length>220) break;
    }
  }
  return final;
}


function faintDustFallback(gray,w,h,existing,mode,strength,minArea){
  const results=[];
  const occupied=(x,y,r=7)=>existing.some(s=>Math.hypot(s.x-x,s.y-y)<Math.max(r,s.r||4)*1.35);
  const maxCount = mode.includes('aggressive') ? 320 : 160;
  const step = mode.includes('aggressive') ? 2 : 3;
  const contrastThreshold = mode.includes('aggressive') ? 3.6 : 4.8;
  const minNeighbourSupport = mode.includes('aggressive') ? 3.0 : 4.0;

  for(let y=11;y<h-11;y+=step){
    for(let x=11;x<w-11;x+=step){
      if(occupied(x,y,7)) continue;
      const centre = gray[y*w+x];

      const n = [
        gray[(y-1)*w+x], gray[(y+1)*w+x],
        gray[y*w+x-1], gray[y*w+x+1],
        gray[(y-1)*w+x-1], gray[(y+1)*w+x+1],
        gray[(y-1)*w+x+1], gray[(y+1)*w+x-1]
      ];
      const nAvg = n.reduce((a,b)=>a+b,0)/n.length;

      let innerSum=0, innerN=0, outerSum=0, outerN=0;
      for(let yy=-6; yy<=6; yy++){
        for(let xx=-6; xx<=6; xx++){
          const d=Math.hypot(xx,yy);
          const v=gray[(y+yy)*w+(x+xx)];
          if(d<=2.4){innerSum+=v; innerN++;}
          else if(d>=4.2 && d<=6.2){outerSum+=v; outerN++;}
        }
      }
      if(!innerN || !outerN) continue;
      const inner=innerSum/innerN;
      const outer=outerSum/outerN;
      const localDiff=outer-inner;
      const neighbourSupport=nAvg-centre;

      let farSum=0, farN=0;
      for(let yy=-10; yy<=10; yy+=2){
        for(let xx=-10; xx<=10; xx+=2){
          const d=Math.hypot(xx,yy);
          if(d>=8 && d<=10){
            farSum += gray[(y+yy)*w+(x+xx)];
            farN++;
          }
        }
      }
      const far=farN ? farSum/farN : outer;
      const broadGradient=Math.abs(far-outer);

      if(localDiff>contrastThreshold && neighbourSupport>minNeighbourSupport && broadGradient<18){
        const radius = localDiff > 8 ? 5.2 : 4.2;
        results.push({x,y,r:radius,area:Math.max(18, radius*radius*Math.PI*0.55),bw:Math.round(radius*2),bh:Math.round(radius*2),elong:1,faint:true});
      }
    }
  }

  const final=[];
  for(const c of results){
    if(!final.some(o=>Math.hypot(o.x-c.x,o.y-c.y)<8)){
      final.push(c);
      if(final.length>=maxCount) break;
    }
  }
  return final;
}


function radialStats(gray,w,h,cx,cy,r,n=28){
  let sum=0, sum2=0, count=0;
  for(let k=0;k<n;k++){
    const a=(Math.PI*2*k)/n;
    const x=Math.round(cx+Math.cos(a)*r);
    const y=Math.round(cy+Math.sin(a)*r);
    if(x>=0&&x<w&&y>=0&&y<h){ const v=gray[y*w+x]; sum+=v; sum2+=v*v; count++; }
  }
  if(!count) return {mean:0,sd:0};
  const mean=sum/count;
  return {mean, sd:Math.sqrt(Math.max(0,sum2/count-mean*mean))};
}
function localCloudiness(gray,w,h,cx,cy,r){
  // Measures broad background variation so clouds are not mistaken for oil rings.
  const vals=[];
  const step=Math.max(3,Math.round(r/3));
  for(let yy=-r*2; yy<=r*2; yy+=step){
    for(let xx=-r*2; xx<=r*2; xx+=step){
      const x=Math.round(cx+xx), y=Math.round(cy+yy);
      if(x>=0&&x<w&&y>=0&&y<h) vals.push(gray[y*w+x]);
    }
  }
  if(vals.length<4) return 999;
  const mean=vals.reduce((a,b)=>a+b,0)/vals.length;
  return vals.reduce((a,b)=>a+Math.abs(b-mean),0)/vals.length;
}
function detectOilHaloPass(gray,w,h,existing,mode,strength){
  // Dedicated halo/ring pass for translucent “fried egg” lubricant/oil marks.
  // It is radial-profile based rather than blob/contrast based.
  const results=[];
  const occupied=(x,y,r)=>existing.some(s=>Math.hypot(s.x-x,s.y-y)<Math.max(r,s.r||6)*0.95);
  const step=mode.includes('aggressive') ? 5 : 7;
  const minR=Math.max(10,Math.round(Math.min(w,h)/150));
  const maxR=Math.max(minR+8,Math.round(Math.min(w,h)/35));
  for(let y=maxR+4;y<h-maxR-4;y+=step){
    for(let x=maxR+4;x<w-maxR-4;x+=step){
      if(occupied(x,y,maxR*0.7)) continue;
      let best=null;
      for(let r=minR;r<=maxR;r+=4){
        const c=radialStats(gray,w,h,x,y,Math.max(2,r*0.25),16).mean;
        const inner=radialStats(gray,w,h,x,y,r*0.55,24);
        const ring=radialStats(gray,w,h,x,y,r,36);
        const outer=radialStats(gray,w,h,x,y,r*1.55,44);
        const cloud=localCloudiness(gray,w,h,x,y,r);
        // Fried-egg score: pale/defined halo ring with different centre and stable outer field.
        const ringLift = ring.mean - outer.mean;
        const centreDiff = Math.abs(c - ring.mean);
        const ringDefinition = Math.abs(ring.mean - inner.mean) + Math.abs(ring.mean - outer.mean);
        const roundness = 1/(1+ring.sd/18);
        const score = (ringDefinition*1.4) + (centreDiff*0.8) + Math.max(0,ringLift)*0.6 + (roundness*8) - (cloud*0.45);
        if(ringDefinition>4.5 && centreDiff>3.2 && cloud<24 && score>12){
          if(!best || score>best.score) best={x,y,r:r*1.05,area:Math.PI*r*r,bw:r*2,bh:r*2,oil:true,halo:true,score};
        }
      }
      if(best) results.push(best);
    }
  }
  results.sort((a,b)=>b.score-a.score);
  const final=[];
  for(const c of results){
    if(!final.some(o=>Math.hypot(o.x-c.x,o.y-c.y)<Math.max(o.r,c.r)*0.8)){
      final.push(c);
      if(final.length>80) break;
    }
  }
  return final;
}


function detectLargeTranslucentOilPass(gray,w,h,existing,mode,strength){
  // Detects large, translucent oval/circular "fried egg" oil/grease marks.
  // Built for low-contrast DSLR lubricant patterns that are often missed by dust thresholding.
  const results=[];
  const occupied=(x,y,r)=>existing.some(s=>Math.hypot(s.x-x,s.y-y)<Math.max(r,s.r||8)*0.75);
  const minDim=Math.min(w,h);
  const step=mode.includes('aggressive') ? 7 : 9;
  const minR=Math.max(16,Math.round(minDim/90));
  const maxR=Math.max(minR+20,Math.round(minDim/9));

  function annulus(cx,cy,r1,r2,skip=2){
    let sum=0,sum2=0,n=0;
    for(let yy=-r2;yy<=r2;yy+=skip){
      for(let xx=-r2;xx<=r2;xx+=skip){
        const d=Math.hypot(xx,yy);
        if(d>=r1 && d<=r2){
          const x=Math.round(cx+xx), y=Math.round(cy+yy);
          if(x>=0&&x<w&&y>=0&&y<h){
            const v=gray[y*w+x]; sum+=v; sum2+=v*v; n++;
          }
        }
      }
    }
    if(!n) return {mean:0,sd:999,n:0};
    const mean=sum/n;
    return {mean,sd:Math.sqrt(Math.max(0,sum2/n-mean*mean)),n};
  }

  for(let y=maxR+3;y<h-maxR-3;y+=step){
    for(let x=maxR+3;x<w-maxR-3;x+=step){
      if(occupied(x,y,maxR*0.6)) continue;
      let best=null;
      for(let r=minR;r<=maxR;r+=Math.max(5,Math.round(r/5))){
        const centre=annulus(x,y,0,Math.max(3,Math.round(r*0.28)),2);
        const inner=annulus(x,y,Math.round(r*0.35),Math.round(r*0.62),2);
        const ring=annulus(x,y,Math.round(r*0.72),Math.round(r*1.05),2);
        const outer=annulus(x,y,Math.round(r*1.25),Math.round(r*1.65),3);
        if(!centre.n || !ring.n || !outer.n) continue;

        // Oil halo can be pale or darker than surrounding, so use absolute transitions.
        const ringVsOuter=Math.abs(ring.mean-outer.mean);
        const centreVsRing=Math.abs(centre.mean-ring.mean);
        const innerVsRing=Math.abs(inner.mean-ring.mean);
        const softEnough = ring.sd < 22 && outer.sd < 32;   // rejects cloud edges/texture
        const visibleStructure = (ringVsOuter + centreVsRing + innerVsRing);
        const contrastOK = visibleStructure > (mode.includes('aggressive') ? 5.0 : 6.5);
        const cloudPenalty = Math.max(0, outer.sd-18) * 0.55;
        const score = visibleStructure*2.0 + (softEnough?8:0) - cloudPenalty;

        if(contrastOK && score > (mode.includes('aggressive') ? 13 : 16)){
          const cand={x,y,r:r*1.05,area:Math.PI*r*r,bw:r*2,bh:r*2,oil:true,halo:true,translucent:true,score};
          if(!best || cand.score>best.score) best=cand;
        }
      }
      if(best) results.push(best);
    }
  }

  results.sort((a,b)=>b.score-a.score);
  const final=[];
  for(const c of results){
    if(!final.some(o=>Math.hypot(o.x-c.x,o.y-c.y)<Math.max(o.r,c.r)*0.9)){
      final.push(c);
      if(final.length>40) break;
    }
  }
  return final;
}

function runDetection(){
  if(!originalData) return;
  // Sensitivity is user-facing detection strength: higher value = lower threshold / more detection.
  const strength = Number($('sensitivity').value);
  const minArea = Number($('minSize').value);
  const modeBtn = document.querySelector('.mode.active');
  const mode = modeBtn ? modeBtn.textContent.trim().toLowerCase() : 'standard';
  const w=canvas.width,h=canvas.height,data=originalData.data;
  const gray = new Uint8ClampedArray(w*h);
  let mean=0;
  for(let i=0,p=0;i<data.length;i+=4,p++){
    const g=Math.round((data[i]*.299+data[i+1]*.587+data[i+2]*.114));
    gray[p]=g; mean+=g;
  }
  mean/=gray.length;

  // Multi-scale local-background comparison. This handles normal small sensor dust AND extreme bonded debris.
  const r1 = mode.includes('aggressive') ? 11 : (mode.includes('high') ? 15 : 19);
  const r2 = mode.includes('aggressive') ? 35 : (mode.includes('high') ? 45 : 55);
  const blurSmall = boxBlur(gray,w,h,r1);
  const blurLarge = boxBlur(gray,w,h,r2);
  const threshold = Math.max(mode.includes('aggressive') ? 5.5 : 7.5, 62 - strength * (mode.includes('aggressive') ? 0.62 : 0.55)); // 90 strength ≈ 12.5 threshold
  const absoluteDark = Math.max(18, mean - (mode.includes('aggressive') ? 42 : 55));
  const mask = new Uint8Array(w*h);
  for(let i=0;i<gray.length;i++){
    const localDiff = Math.max(blurSmall[i]-gray[i], blurLarge[i]-gray[i]);
    const veryDark = gray[i] < absoluteDark;
    const obviousEdge = localDiff > threshold;
    // Combine local contrast and absolute darkness to avoid splitting large dark contamination into small pieces.
    if(obviousEdge || (veryDark && localDiff > threshold*.45)) mask[i]=1;
  }

  // Closing joins cracked/fragmented deposits into coherent contamination regions.
  const closed = closeMask(mask,w,h, mode.includes('aggressive') ? 2 : 1);
  const detectedComponents = connectedComponents(closed,w,h,Math.max(1,minArea), w*h).map(c=>({
    x:c.cx,
    y:c.cy,
    r:Math.max(5,Math.sqrt(c.area/Math.PI)*1.45),
    area:c.area,
    bw:c.bw,
    bh:c.bh,
    elong:c.elong
  }));

  oilSpots = [];
  gritSpots = [];
  spots = [];

  detectedComponents.forEach(s => {
    const type = classifyComponentFast(s, gray, w, h);
    if(type === 'grit') gritSpots.push({...s, grit:true});
    else if(type === 'oil') oilSpots.push({...s, oil:true});
    else spots.push({...s, oil:false, grit:false});
  });
  render(); updateResults(summary());
}

function dilateMask(src,w,h,r){
  const out=new Uint8Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    let found=0;
    for(let yy=Math.max(0,y-r);yy<=Math.min(h-1,y+r)&&!found;yy++){
      for(let xx=Math.max(0,x-r);xx<=Math.min(w-1,x+r);xx++){
        if(src[yy*w+xx]){found=1;break;}
      }
    }
    out[y*w+x]=found;
  }
  return out;
}
function erodeMask(src,w,h,r){
  const out=new Uint8Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    let keep=1;
    for(let yy=Math.max(0,y-r);yy<=Math.min(h-1,y+r)&&keep;yy++){
      for(let xx=Math.max(0,x-r);xx<=Math.min(w-1,x+r);xx++){
        if(!src[yy*w+xx]){keep=0;break;}
      }
    }
    out[y*w+x]=keep;
  }
  return out;
}
function closeMask(src,w,h,r){ return erodeMask(dilateMask(src,w,h,r),w,h,r); }

function boxBlur(src,w,h,r){
  const out=new Uint8ClampedArray(w*h), tmp=new Uint32Array(w*h);
  for(let y=0;y<h;y++){
    let sum=0; for(let x=-r;x<=r;x++) sum+=src[y*w+Math.min(w-1,Math.max(0,x))];
    for(let x=0;x<w;x++){ tmp[y*w+x]=sum/(2*r+1); sum-=src[y*w+Math.max(0,x-r)]; sum+=src[y*w+Math.min(w-1,x+r+1)]; }
  }
  for(let x=0;x<w;x++){
    let sum=0; for(let y=-r;y<=r;y++) sum+=tmp[Math.min(h-1,Math.max(0,y))*w+x];
    for(let y=0;y<h;y++){ out[y*w+x]=sum/(2*r+1); sum-=tmp[Math.max(0,y-r)*w+x]; sum+=tmp[Math.min(h-1,y+r+1)*w+x]; }
  }
  return out;
}

function connectedComponents(mask,w,h,minArea,maxArea){
  const seen=new Uint8Array(w*h), comps=[];
  const qx=new Int32Array(w*h), qy=new Int32Array(w*h);
  const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const start=y*w+x; if(!mask[start]||seen[start]) continue;
    let head=0,tail=0,area=0,sx=0,sy=0,minx=x,maxx=x,miny=y,maxy=y;
    qx[tail]=x;qy[tail++]=y;seen[start]=1;
    while(head<tail){
      const cx=qx[head],cy=qy[head++]; area++; sx+=cx; sy+=cy;
      if(cx<minx)minx=cx;if(cx>maxx)maxx=cx;if(cy<miny)miny=cy;if(cy>maxy)maxy=cy;
      for(const [dx,dy] of dirs){
        const nx=cx+dx, ny=cy+dy;
        if(nx<0||ny<0||nx>=w||ny>=h) continue;
        const ni=ny*w+nx;
        if(mask[ni]&&!seen[ni]){seen[ni]=1;qx[tail]=nx;qy[tail++]=ny;}
      }
    }
    const bw=maxx-minx+1,bh=maxy-miny+1,elong=Math.max(bw,bh)/Math.max(1,Math.min(bw,bh));
    if(area>=minArea && area<=maxArea) comps.push({area,cx:sx/area,cy:sy/area,bw,bh,elong});
  }
  return comps.sort((a,b)=>b.area-a.area).slice(0,900);
}


function imageDataToDataUrl(imageData){
  if(!imageData) return '';
  const c=document.createElement('canvas');
  c.width=imageData.width; c.height=imageData.height;
  const cctx=c.getContext('2d');
  cctx.putImageData(imageData,0,0);
  return c.toDataURL('image/png');
}

function createCleanPreview(){
  if(!originalData) return;
  const w=canvas.width,h=canvas.height;
  const out = new ImageData(new Uint8ClampedArray(originalData.data), w,h);
  const all=[...spots,...oilSpots,...gritSpots,...manualSpots];
  all.forEach(s=>{
    const rad=Math.ceil(Math.max(8,s.r*1.4));
    for(let yy=Math.max(0,Math.floor(s.y-rad)); yy<Math.min(h,Math.ceil(s.y+rad)); yy++){
      for(let xx=Math.max(0,Math.floor(s.x-rad)); xx<Math.min(w,Math.ceil(s.x+rad)); xx++){
        if(Math.hypot(xx-s.x,yy-s.y)>rad) continue;
        let rs=0,gs=0,bs=0,n=0;
        for(let a=0;a<16;a++){
          const ang=(Math.PI*2*a)/16, sx=Math.round(s.x+Math.cos(ang)*(rad+7)), sy=Math.round(s.y+Math.sin(ang)*(rad+7));
          if(sx>=0&&sy>=0&&sx<w&&sy<h){const p=(sy*w+sx)*4; rs+=originalData.data[p];gs+=originalData.data[p+1];bs+=originalData.data[p+2];n++;}
        }
        if(n){const p=(yy*w+xx)*4, blend=.86; out.data[p]=out.data[p]*(1-blend)+(rs/n)*blend; out.data[p+1]=out.data[p+1]*(1-blend)+(gs/n)*blend; out.data[p+2]=out.data[p+2]*(1-blend)+(bs/n)*blend;}
      }
    }
  });
  cleanData=out; cleanMode=true; render();

  try{
    const before=document.getElementById('compareBefore');
    const after=document.getElementById('compareAfter');
    const compareCanvas=document.createElement('canvas');
    compareCanvas.width=w; compareCanvas.height=h;
    compareCanvas.getContext('2d').putImageData(out,0,0);

    if(before) before.src=canvas.toDataURL('image/png');
    if(after) after.src=compareCanvas.toDataURL('image/png');

    const slider=document.getElementById('compareSlider');
    if(slider && !slider.dataset.bound){
      slider.addEventListener('input', updateCompareSlider);
      slider.dataset.bound='1';
      updateCompareSlider();
    }
  }catch(e){}

}


function cleanPreviewDataUrl(){
  if(!cleanData) createCleanPreview();
  if(!cleanData) return '';
  const c=document.createElement('canvas');
  c.width=cleanData.width;
  c.height=cleanData.height;
  const cctx=c.getContext('2d');
  cctx.putImageData(cleanData,0,0);
  return c.toDataURL('image/png');
}

function downloadCleanPreview(){
  if(!originalData) return alert('Please upload and analyse an image first.');
  if(!cleanData) createCleanPreview();
  const url=cleanPreviewDataUrl();
  if(!url) return alert('Clean preview could not be generated.');
  const a=document.createElement('a');
  const base=(currentFileName||'cameracal-image').replace(/\.[^.]+$/,'').replace(/[^a-z0-9-_]+/gi,'-');
  a.download=base+'-cameracal-clean-preview.png';
  a.href=url;
  a.click();
}

function toggleCleanView(){
  if(!originalData) return alert('Please upload and analyse an image first.');
  if(!cleanData) createCleanPreview();
  cleanMode=!cleanMode;
  render();
}

function summary(){
  const all=[...spots,...oilSpots,...gritSpots,...manualSpots], count=all.length;
  const oilCount=oilSpots.length;
  const gritCount=gritSpots.length;
  const faintCount=all.filter(s=>s.faint).length;
  const heavy=all.filter(s=>s.area>900 || Math.max(s.bw||0,s.bh||0)>32).length;
  const medium=all.filter(s=>!(s.area>900 || Math.max(s.bw||0,s.bh||0)>32) && (s.area>140 || Math.max(s.bw||0,s.bh||0)>12)).length;
  const small=Math.max(0,count-heavy-medium);
  let sev='Low', rec='No immediate action required';
  if(count>65||heavy>8||gritCount>6||oilCount>10){sev='Extreme';rec='Professional inspection / wet clean strongly recommended';}
  else if(count>40||heavy>3||gritCount>2||oilCount>5){sev='High';rec='Professional wet clean recommended';}
  else if(count>15||heavy>0||gritCount>0||oilCount>1){sev='Medium';rec=gritCount>0?'Professional inspection recommended — possible hard particulate':'Professional inspection / wet clean may be required';}
  else if(count>0){sev='Low';rec=oilCount>0?'Monitor / professional inspection if repeated':(gritCount>0?'Professional inspection recommended — possible hard particulate':'Blower check or monitor');}
  const avg=count? all.reduce((a,s)=>a+s.area,0)/count:0;
  const largest=count? Math.max(...all.map(s=>s.area)):0;
  let pattern = count > 0 ? 'Very light / isolated contamination detected' : 'No significant contamination detected';

  const meaningfulDetection = (
    count >= 8 ||
    oilCount >= 2 ||
    gritCount >= 1 ||
    heavy >= 1 ||
    largest > 450 ||
    avg > 160
  );

  if(faintCount>0 && count<=6){ pattern='Very faint / low-contrast dust indicators detected'; }
  if(meaningfulDetection){
    if(gritCount>=1) pattern='Possible grit / sand / granular debris';
    else if(oilCount>=2) pattern='Possible oil / grease / shutter lubricant residue';
    else if(sev==='Extreme' || heavy>=5 || largest>3000) pattern='Possible organic residue / bonded debris';
    else if(heavy>=2 || avg>700) pattern='Possible oil / moisture pattern';
    else pattern='Likely dry dust';
  }
  
  const contaminationArea = count ? all.reduce((a,s)=>a + (Math.PI * Math.pow(Math.max(s.r||1, 1), 2)),0) : 0;
  const physicalCoverage = (canvas.width && canvas.height) ? Math.min(100, (contaminationArea / (canvas.width * canvas.height)) * 100) : 0;

  // Market-facing metric: estimated visible contamination impact, not literal sensor surface coverage.
  // This combines physical coverage, particle count, large/bonded contamination and cluster density.
  const densityImpact = canvas.width && canvas.height ? (count / ((canvas.width * canvas.height) / 1000000)) * 0.18 : count * 0.08;
  const visibleImpact = Math.min(100, Math.round((physicalCoverage * 4.2) + densityImpact + (heavy * 1.8)));
  const coverage = visibleImpact;
  const healthScore = Math.max(0, Math.round(100 - Math.min(98, (coverage * 0.75) + (heavy * 1.5) + (oilCount*1.2) + (gritCount*3.0))));
  return {count,small,medium,large:heavy,oilCount,gritCount,faintCount,batchConfidence:lastBatchSummary?lastBatchSummary.fixed.confidence:null,batchMatches:lastBatchSummary?lastBatchSummary.fixed.matched:0,sev,rec,pattern,coverage,physicalCoverage,healthScore,meaningfulDetection};

}

function apertureVisibility(s){
  const heavyFactor = s.large * 4;
  const coverageFactor = (s.coverage || 0) * 12;
  const score = s.count + heavyFactor + coverageFactor;
  const pctFor = (multiplier) => Math.max(0, Math.min(100, Math.round(score * multiplier)));
  const riskFromPct = (pct) => {
    if(pct >= 80) return 'Extreme';
    if(pct >= 55) return 'High';
    if(pct >= 30) return 'Moderate';
    if(pct >= 12) return 'Low';
    return 'Minimal';
  };
  const make = (ap, multiplier, note) => {
    const pct=pctFor(multiplier);
    return {ap, pct, risk:riskFromPct(pct), note};
  };
  const rows = [
    make('f/4', 0.10, 'Only larger or bonded contamination is usually visible at wider apertures.'),
    make('f/5.6', 0.16, 'Large spots, residue and bonded debris may appear on plain skies or backgrounds.'),
    make('f/8', 0.28, 'Contamination can become noticeable on skies, studio backdrops and smooth tones.'),
    make('f/11', 0.42, 'Dust visibility increases significantly on skies, white backgrounds and studio backdrops.'),
    make('f/16', 0.68, 'This is a recommended dust-test aperture range and reveals most contamination.'),
    make('f/22', 0.90, 'Small particles, faint marks and bonded residue become much more visible.')
  ];
  const overall = rows.some(r=>r.risk==='Extreme')?'Extreme':rows.some(r=>r.risk==='High')?'High':rows.some(r=>r.risk==='Moderate')?'Moderate':rows.some(r=>r.risk==='Low')?'Low':'Minimal';
  return {overall, rows};
}

function updateResults(s){
  if(!s){
    $('spotCount').textContent='–';$('severity').textContent='–';$('pattern').textContent='–';
    if($('recommendation')) $('recommendation').textContent='–';
    if($('smallCount'))$('smallCount').textContent='–';
    if($('mediumCount'))$('mediumCount').textContent='–';
    if($('largeCount'))$('largeCount').textContent='–';
    if($('apertureRisk'))$('apertureRisk').textContent='–';
    if($('specialDetectionCard')) $('specialDetectionCard').hidden=true;
    return;
  }
  $('spotCount').textContent=s.count;
  $('severity').textContent=s.sev;
  $('pattern').textContent=s.pattern;
  if($('recommendation')) $('recommendation').textContent=s.rec + (s.batchConfidence ? ' · Fixed-position comparison: ' + s.batchConfidence : '');
  if($('smallCount'))$('smallCount').textContent=s.small;
  if($('mediumCount'))$('mediumCount').textContent=s.medium;
  if($('largeCount'))$('largeCount').textContent=s.large;
  if($('apertureRisk'))$('apertureRisk').textContent=apertureVisibility(s).overall;

  const card=$('specialDetectionCard');
  if(card){
    const text=$('specialDetectionText');
    const advice=$('specialDetectionAdvice');
    card.classList.remove('danger');
    if((s.gritCount||0)>0){
      card.hidden=false;
      card.classList.add('danger');
      text.textContent=`Possible grit / sand indicators: ${s.gritCount}`;
      advice.textContent='Hard particulate may be abrasive. Avoid contact cleaning and seek professional inspection.';
    } else if((s.oilCount||0)>0){
      card.hidden=false;
      text.textContent=`Possible oil / grease indicators: ${s.oilCount}`;
      advice.textContent="Circular halo / ring ('fried egg') style marks detected. These may be consistent with oil, grease or shutter lubricant residue. Physical inspection is recommended for confirmation.";
    } else {
      card.hidden=true;
    }
  }
}
function render(){
  if(!originalData) return;
  ctx.putImageData(cleanMode&&cleanData?cleanData:originalData,0,0);
  if(overlay){
    ctx.save(); ctx.lineWidth=Math.max(2,canvas.width/900);
    const dustColour=getDustOverlayColour();
    [...spots,...manualSpots].forEach((s,i)=>{ctx.strokeStyle=dustColour;ctx.fillStyle=dustColour+'16';ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();ctx.stroke(); if(i<80){ctx.fillStyle=dustColour;ctx.font=`${Math.max(9,canvas.width/170)}px Arial`;ctx.fillText(String(i+1),s.x+s.r+3,s.y);}});
    oilSpots.forEach((s,i)=>{ctx.strokeStyle='#ff9900';ctx.fillStyle='rgba(255,153,0,.12)';ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.arc(s.x,s.y,Math.max(3,s.r*.45),0,Math.PI*2);ctx.stroke(); if(i<80){ctx.fillStyle='#ff9900';ctx.font=`${Math.max(9,canvas.width/170)}px Arial`;ctx.fillText('O'+String(i+1),s.x+s.r+3,s.y);}});
    gritSpots.forEach((s,i)=>{ctx.strokeStyle='#7e2cff';ctx.fillStyle='rgba(126,44,255,.12)';ctx.beginPath();ctx.rect(s.x-s.r,s.y-s.r,s.r*2,s.r*2);ctx.fill();ctx.stroke(); if(i<80){ctx.fillStyle='#7e2cff';ctx.font=`${Math.max(9,canvas.width/170)}px Arial`;ctx.fillText('G'+String(i+1),s.x+s.r+3,s.y);}});
    ctx.restore();
  }
}
function fitCanvas(){
  if(!canvas.width || !canvas.height){ scale=1; applyScale(); return; }
  const wrap = $('canvasWrap');
  const availW = Math.max(320, wrap.clientWidth - 24);
  const availH = Math.max(260, wrap.clientHeight - 24);
  scale = Math.min(availW / canvas.width, availH / canvas.height, 1.15);
  if(scale <= 0 || !isFinite(scale)) scale = 1;
  applyScale();
}
function applyScale(){
  canvas.style.width=(canvas.width*scale)+'px';
  canvas.style.height=(canvas.height*scale)+'px';
  $('zoomLabel').textContent=Math.round(scale*100)+'%';
}

function saveAnnotated(){
  render();
  const a=document.createElement('a');
  const base=(currentFileName||'cameracal-image').replace(/\.[^.]+$/,'').replace(/[^a-z0-9-_]+/gi,'-');
  a.download=base+'-cameracal-annotated-dust-map.png';
  a.href=canvas.toDataURL('image/png');
  a.click();
}




function generateReportWindow(){
  if(!originalData) return alert('Please upload and analyse an image first.');
  if(!paid) return alert('Please unlock the full report first. For beta testing, tick Developer Demo or use Unlock Full Report.');

  const s=summary();
  const av=apertureVisibility(s);

  if(!cleanData) createCleanPreview();
  render();

  const imgUrl=canvas.toDataURL('image/png');
  const cleanUrl=(typeof cleanPreviewDataUrl === 'function') ? cleanPreviewDataUrl() : imageDataToDataUrl(cleanData);
  const heatUrl=(typeof generateHeatMapCanvas === 'function') ? generateHeatMapCanvas() : imgUrl;
  const logoUrl=document.querySelector('.brandLogo') ? document.querySelector('.brandLogo').src : '';
  const vsgoUrl='vsgo-air-move-blower.png';

  const noDetection = s.count === 0;
  const lightDetection = s.count > 0 && !s.meaningfulDetection;

  const confidenceOrganic = (noDetection || lightDetection) ? 0 : Math.min(95, Math.round((s.large*5) + (s.coverage*8) + (s.count>100?35:15)));
  const confidenceMoisture = (noDetection || lightDetection) ? 0 : Math.min(88, Math.round((s.large*3) + (s.coverage*5) + (s.pattern.includes('moisture')?35:20)));
  const confidenceDry = (noDetection || lightDetection) ? 0 : Math.max(5, Math.round(100 - Math.max(confidenceOrganic, confidenceMoisture)/1.4));
  const confidenceOil = (noDetection || lightDetection) ? 0 : Math.min(96, Math.round((s.oilCount||0)*18 + (s.pattern.includes('oil')?45:0)));
  const confidenceGrit = (noDetection || lightDetection) ? 0 : Math.min(96, Math.round((s.gritCount||0)*28 + (s.pattern.includes('grit')||s.pattern.includes('sand')?45:0)));

  const interpretationHtml = noDetection ? `
    <div class="cta"><h3>No measurable contamination detected</h3><p>No significant dust spots, bonded debris clusters or residue patterns were detected from the supplied image.</p><p>Contamination confidence classification has been suppressed because there is insufficient measurable evidence to identify a reliable contamination pattern.</p></div>
    <p class="small">If contamination is still visible in real photographs, repeat the test using a plain blue sky or white background at f/16–f/22, with the lens deliberately defocused. Avoid prominent clouds or patterned backgrounds.</p>
  ` : lightDetection ? `
    <div class="cta"><h3>Very light / isolated contamination detected</h3><p>${s.count} isolated mark${s.count===1?' was':'s were'} detected from the supplied image.</p><p>The level detected is too low to produce a reliable contamination-type classification, so dust / oil / grease / grit / bonded debris confidence percentages have been suppressed.</p><p>Recommended action: blower check, monitor, or re-test using a controlled f/16–f/22 dust-test image.</p></div>
    <p class="small">Small isolated marks may not be visible in most everyday photographs, but may appear on plain skies, white backgrounds or smooth studio backdrops at smaller apertures.</p>
  ` : `
    <p>Where a contamination type is suggested, it is an indicative pattern only. Physical inspection may be required for confirmation, especially with suspected bonded debris, organic residue, oil / grease / shutter lubricant, hard grit / sand, or moisture-related contamination.</p>

    ${(s.oilCount||0)>0 ? `
    <div class="cta">
      <h3>Possible oil / grease / shutter lubricant contamination detected</h3>
      <p>
      Circular halo or ring-type contamination patterns have been detected within the supplied image. 
      This style of contamination can sometimes be associated with shutter mechanism lubricant, mirror mechanism lubricant or internal oily residue contamination.
      </p>
      <p>
      Oil-style contamination often becomes increasingly visible at smaller apertures such as f/16–f/22 and may appear more obvious against skies, plain backgrounds and high-contrast scenes.
      </p>
      <p>
      Filtered air cleaning may not fully remove lubricant-style contamination and wet cleaning or professional inspection may be required.
      </p>
      <p><strong>
      Pattern classification is indicative only and must not be treated as a definitive diagnosis without physical inspection.
      </strong></p>
    </div>` : ``}

    ${(s.gritCount||0)>0 ? `
    <div class="cta">
      <h3>Possible grit / sand / granular debris detected</h3>
      <p>
      Larger irregular high-contrast particulate contamination has been detected within the supplied image. 
      This may be consistent with grit, sand, salt crystals or other hard granular debris.
      </p>
      <p>
      Hard particulate contamination may be abrasive. In some circumstances, attempting contact cleaning with sensor swabs may risk scratching or damaging the sensor filter glass if particles become trapped during the cleaning process.
      </p>
      <p>
      Professional inspection is strongly recommended before attempting wet cleaning where granular contamination is suspected.
      </p>
      <p><strong>
      Avoid aggressive contact cleaning if hard particulate contamination is suspected.
      </strong></p>
    </div>` : ``}

    <p></p><p>${(s.oilCount||0)>0 ? `Oil/grease indicators: circular halo or lubricant-style marks were detected. Physical inspection is recommended for confirmation.` : ``}</p><p>${(s.gritCount||0)>0 ? `Grit/sand indicators: larger high-contrast irregular particles were detected. Hard particulate contamination may be abrasive; avoid contact cleaning and seek professional inspection.` : ``}</p>
    <div class="grid4"><div class="card">Dry dust / particles<strong>${confidenceDry}%</strong><div class="bar"><span style="width:${confidenceDry}%"></span></div></div><div class="card">Oil / grease / lubricant<strong>${confidenceOil}%</strong><div class="bar"><span style="width:${confidenceOil}%"></span></div></div><div class="card">Grit / sand / granular debris<strong>${confidenceGrit}%</strong><div class="bar"><span style="width:${confidenceGrit}%"></span></div></div><div class="card">Organic / bonded debris<strong>${confidenceOrganic}%</strong><div class="bar"><span style="width:${confidenceOrganic}%"></span></div></div><div class="card">Moisture / oily residue<strong>${confidenceMoisture}%</strong><div class="bar"><span style="width:${confidenceMoisture}%"></span></div></div></div>
    <p class="small">Confidence levels are indicative only. Physical inspection may be required for confirmation.</p>
  `;

  const heatText = noDetection ? `<p class="small"><b>No heat-map activity:</b> no measurable contamination clusters were detected, so no density zones are shown.</p>` :
    lightDetection ? `<p class="small"><b>Very light activity:</b> isolated marks were detected, but there are no meaningful contamination clusters or density zones.</p>` :
    `<p class="small">Heat map visualisation estimates contamination density and cluster severity across the sensor area.</p>`;

  const html=`<!doctype html><html><head><title>Cameracal Sensor Health Report</title><style>
    body{font-family:Arial,sans-serif;margin:0;color:#10223d;background:#fff}
    .page{padding:30px 34px;page-break-after:always}
    .head{display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #0057d8;padding-bottom:14px}
    .head img{width:420px;max-height:130px;object-fit:contain}
    h1{margin:0;color:#0057d8;font-size:34px} h2{color:#0057d8;margin-top:0}.red{color:#e00000}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}.grid4{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:18px 0}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0}
    .card{border:1px solid #c9d9ef;border-radius:8px;padding:14px;background:#f8fbff}.card strong{display:block;font-size:26px;color:#0057d8}
    .map{max-width:100%;border:1px solid #c9d9ef;border-radius:10px}.clean{width:100%;border:1px solid #c9d9ef;border-radius:10px}
    .cta{border:2px solid #0057d8;padding:18px;border-radius:12px;background:#f1f7ff}.small{color:#56667d;font-size:12px;line-height:1.4}
    table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border:1px solid #c9d9ef;padding:10px;text-align:left}th{background:#f1f7ff;color:#0057d8}
    .bar{height:10px;background:#e9eef7;border-radius:8px;overflow:hidden;margin-top:6px}.bar span{display:block;height:100%;background:#0057d8}
    .product{display:grid;grid-template-columns:220px 1fr;gap:18px;align-items:center}.product img{max-width:210px;max-height:260px;object-fit:contain}.badge{display:inline-block;background:#e8f5ec;color:#14773b;padding:4px 8px;border-radius:20px;font-weight:bold;font-size:12px}
    .button{display:inline-block;background:#0057d8;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold}
    .heatLegend{display:flex;gap:14px;margin-top:12px}.heatItem{display:flex;align-items:center;gap:6px;font-size:13px}.heatSwatch{width:18px;height:18px;border-radius:4px}
    @media print{button{display:none}.page{break-after:page}}
  </style></head><body>

  <div class="page"><div class="head"><div><h1>Sensor Health Check Report</h1><p><b>Cameracal Services – The Camera Specialist</b><br>Dust Verification & Analysis Report</p></div><img src="${logoUrl}" alt="Cameracal Services"></div><p><b>Report date:</b> ${new Date().toLocaleString()}<br><b>Image:</b> ${currentFileName||'Uploaded image'}<br><b>Report ID:</b> CS-${Date.now()}</p><div class="grid"><div class="card">Total spots<strong>${s.count}</strong></div><div class="card">Severity<strong class="${s.sev==='Extreme'?'red':''}">${s.sev}</strong></div><div class="card">Visible contamination impact<strong>${s.coverage.toFixed(0)}%</strong></div><div class="card">Health score<strong>${s.healthScore}/100</strong></div></div>${((s.oilCount||0)>0||(s.gritCount||0)>0) ? `<div class="cta"><h3>Special contamination indicators</h3><p>${(s.oilCount||0)>0 ? `Possible oil / grease / lubricant indicators detected: <b>${s.oilCount}</b><br>` : ``}${(s.gritCount||0)>0 ? `Possible grit / sand / granular debris indicators detected: <b>${s.gritCount}</b><br><b>Do not attempt contact cleaning if hard particulate contamination is suspected.</b>` : ``}</p></div>` : ``}<p>This report analyses sensor contamination visible under dust-revealing conditions. Results depend on the supplied image and shooting conditions.</p><p class="small"><b>Visible Contamination Impact</b> is a practical severity estimate based on spot count, spot size, clustering and heavy contamination. It is not a literal measurement of physical sensor area covered.</p></div>

  <div class="page"><h2>Dust Map & Distribution</h2><img class="map" src="${imgUrl}"><div class="grid"><div class="card">Small<strong>${s.small}</strong><span class="small">1–4px</span></div><div class="card">Medium<strong>${s.medium}</strong><span class="small">5–15px</span></div><div class="card">Large / Heavy<strong>${s.large}</strong><span class="small">&gt;15px</span></div><div class="card">Visible impact<strong>${s.coverage.toFixed(0)}%</strong></div></div></div>

  <div class="page"><h2>Contamination Heat Map</h2><img class="map" src="${heatUrl}"><div class="heatLegend"><div class="heatItem"><span class="heatSwatch" style="background:#ff0000"></span>Red = heavy concentration / larger bonded contamination</div><div class="heatItem"><span class="heatSwatch" style="background:#ff8c00"></span>Orange = moderate contamination clusters</div><div class="heatItem"><span class="heatSwatch" style="background:#ffe600"></span>Yellow = lighter contamination or smaller dust particles</div><div class="heatItem"><span class="heatSwatch" style="background:#7e2cff"></span>Purple = possible grit / sand / granular particulate indicators</div></div>${heatText}</div>

  <div class="page"><h2>Clean Preview Simulation</h2><div class="grid2"><div><h3>Detection Map</h3><img class="clean" src="${imgUrl}"></div><div><h3>Automated Clean Preview</h3><img class="clean" src="${cleanUrl || imgUrl}"></div></div><p class="small">The automated clean preview is a visual simulation intended for plain skies, white backgrounds and dust-test images. It is not a replacement for professional retouching or physical sensor cleaning.</p></div>

  <div class="page"><h2>Interpretation & Contamination Confidence</h2><p><b>Observed pattern:</b> ${s.pattern}.</p>${interpretationHtml}</div>

  <div class="page"><h2>Aperture Visibility Estimate</h2><p>This paid report includes an estimated guide to how likely the detected contamination is to be visible at wider and smaller apertures. This is calculated from the supplied dust-test image, total spot count, visible contamination impact and heavy contamination level.</p><table><thead><tr><th>Aperture</th><th>Estimated Visible Contamination</th><th>Estimated Visibility Risk</th><th>Comment</th></tr></thead><tbody>${av.rows.map(r=>`<tr><td><b>${r.ap}</b></td><td><b>${r.pct}%</b></td><td><b>${r.risk}</b></td><td>${r.note}</td></tr>`).join('')}</tbody></table><p class="small">For a true measured aperture comparison, upload a controlled set of images taken at f/4, f/5.6, f/8, f/11, f/16 and f/22. This can be added as a future Pro report mode.</p></div>

  <div class="page"><h2>Recommended Prevention Tool</h2><div class="cta product"><img src="${vsgoUrl}" alt="VSGO Air-Move Filter Blower"><div><span class="badge">Recommended</span><h3 style="color:#0057d8">VSGO Air-Move Filter Blower</h3><p>To help minimise future sensor contamination, Cameracal Services recommends periodic use of a filtered air blower system.</p><ul><li>Helps reduce airborne dust entering the camera chamber</li><li>Useful before and after lens changes</li><li>Particularly useful for mirrorless cameras and outdoor work</li><li>Suitable for preventative maintenance only</li></ul><p><b>Available from Cameracal Services</b></p></div></div><p class="small">This recommendation relates to preventative airflow maintenance only. This report does not recommend customer wet cleaning or sensor swab use.</p></div>

  <div class="page"><h2>Professional Sensor Cleaning</h2><p><b>${lightDetection ? 'Very light isolated contamination detected — blower check or monitor recommended' : s.rec}</b></p><div class="cta"><p>Where contamination becomes bonded, oily, moisture related, organic, hard/granular, or resistant to filtered air cleaning, professional sensor cleaning may be required. If grit or sand is suspected, avoid contact cleaning and seek professional inspection.</p><h3>CAMERACAL SERVICES</h3><p>Professional sensor cleaning, contamination diagnostics, autofocus calibration and camera health checks.</p><p><b>07540 877068</b><br>info@cameracalservices.co.uk<br>www.cameracalservices.co.uk</p><p><a class="button" href="mailto:info@cameracalservices.co.uk?subject=Sensor%20cleaning%20booking%20request">Book a Sensor Clean</a></p></div></div>

  <button onclick="window.print()" style="position:fixed;right:20px;top:20px;padding:12px 18px">Print / Save as PDF</button></body></html>`;

  const w=window.open('', '_blank');
  if(!w){ alert('The report window was blocked by the browser. Please allow pop-ups for this page and try again.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// Information modals for top navigation
(function(){
  const modal = document.getElementById('infoModal');
  const title = document.getElementById('modalTitle');
  const content = document.getElementById('modalContent');
  const close = document.getElementById('modalClose');
  const how = document.getElementById('howBtn');
  const help = document.getElementById('helpBtn');
  const show = (heading, html) => { title.textContent = heading; content.innerHTML = html; modal.hidden = false; };
  if (how) how.addEventListener('click', () => show('How it works', `
    <ol class="modalList">
      <li><b>Choose JPEG as the recommended version</b> for this app.</li>
      <li><b>Take a dust-test image</b> at F16 / F22, ideally of a plain white background or blue sky.</li>
      <li><b>Upload the JPEG</b> into the app and run Auto Detect to highlight visible dust, debris, smears or bonded contamination.</li>
      <li><b>Review the result</b> using the manual Add Mark and improved Erase tools if required.</li>
      <li><b>Generate the paid report</b> to unlock the PDF, aperture visibility estimate and cleaning recommendation.</li>
    </ol>
    <p>The report is designed to help decide whether a blower clean, wet clean, or professional Cameracal Services sensor clean is recommended.</p>`));
  if (help) help.addEventListener('click', () => show('Help', `
    <h3>Recommended image</h3>
    <p>Use a JPEG image taken at F16 / F22 of a plain bright subject. Defocus the lens slightly and avoid patterned backgrounds.</p>
    <h3>Manual tools</h3>
    <p><b>Add Mark</b> allows you to click missed contamination. <b>Erase</b> now uses a wider removal area and removes the nearest detected or manually added mark near the cursor. <b>Clear All</b> removes manual adjustments.</p>
    <h3>Report access</h3>
    <p>The free preview shows the detection result. The full PDF report, downloadable overlay and aperture visibility guidance are unlocked after payment.</p>
    <h3>Maximum sensitivity mode</h3><p>For very faint contamination, use Aggressive mode, 100% detection strength and the smallest spot size. This enables an additional micro-dust pass designed to find very small low-contrast dust marks while still rejecting single-pixel noise.</p><h3>False-negative prevention mode</h3><p>If the main detector finds few or no marks while using High Detail or Aggressive mode, the app now runs a second faint-dust pass. This helps catch very low-contrast contamination that may be visible under manual inspection but difficult for normal automated detection.</p><h3>Image metadata panel</h3><p>The upload panel now displays JPEG EXIF data where available, including aperture, shutter speed, ISO, camera model, lens and capture date. This helps compare dust-test images taken at different apertures such as f/11, f/16 and f/22.</p><h3>Multi-aperture testing</h3><p>You can upload several JPEG test images together, for example f/11, f/16, f/22 and f/32. The batch analyser compares fixed-position indicators across the images, which helps separate real sensor contamination from clouds or background texture.</p>
<h3>Oil / grease halo detection</h3><p>The engine now includes a larger translucent halo pass for 'fried egg' oil/grease marks: pale or darker oval/circular rings, centre-ring differences and soft translucent residue patterns.</p><h3>Need a clean?</h3>
    <p>Use the Book a Sensor Clean button or contact Cameracal Services on 07540 877068.</p>`));
  if (close) close.addEventListener('click', () => modal.hidden = true);
  if (modal) modal.addEventListener('click', (e) => { if(e.target === modal) modal.hidden = true; });
  window.addEventListener('keydown', e => { if(e.key === 'Escape' && modal && !modal.hidden) modal.hidden = true; });
})();


try{
  const cleanExportBtn = document.getElementById('cleanupBtn');
  if(cleanExportBtn && !cleanExportBtn.dataset.cleanExportBound){
    cleanExportBtn.addEventListener('click', downloadCleanPreview);
    cleanExportBtn.dataset.cleanExportBound='1';
  }
  const toggleCleanBtn = document.getElementById('toggleClean');
  if(toggleCleanBtn && !toggleCleanBtn.dataset.toggleCleanBound){
    toggleCleanBtn.addEventListener('click', toggleCleanView);
    toggleCleanBtn.dataset.toggleCleanBound='1';
  }
}catch(e){}


// Final robust control bindings
(function(){
  const bind = (id, fn) => {
    const el=document.getElementById(id);
    if(el && !el.dataset.finalBound){
      el.addEventListener('click', fn);
      el.dataset.finalBound='1';
    }
  };
  bind('reportBtn', generateReportWindow);
  bind('cleanupBtn', downloadCleanPreview);
  bind('toggleClean', toggleCleanView);
  bind('zoomIn', ()=>{scale=Math.min(4,scale*1.2); applyScale();});
  bind('zoomOut', ()=>{scale=Math.max(.15,scale/1.2); applyScale();});
  bind('fitBtn', fitCanvas);
  bind('enlargeBtn', ()=>{
    if(!originalData) return alert('Please upload an image first.');
    enlargeMode=!enlargeMode;
    $('canvasWrap').classList.toggle('enlargeMode', enlargeMode);
    $('enlargeBtn').classList.toggle('active', enlargeMode);
    if(enlargeMode){ updateLoupe(canvas.width/2, canvas.height/2, null); }
    else { if(loupe) loupe.hidden=true; }
  });
})();



/* FINAL REPLACEMENT: Standalone Enlarge / Loupe Tool
   This deliberately bypasses earlier enlarge handlers. */
(function(){
  const btn = document.getElementById('enlargeBtn');
  const main = document.getElementById('mainCanvas');
  const wrap = document.getElementById('canvasWrap');
  if(!btn || !main || !wrap) return;

  let enabled = false;
  let pinned = false;

  let lens = document.getElementById('finalLoupeLens');
  if(!lens){
    lens = document.createElement('div');
    lens.id = 'finalLoupeLens';
    lens.innerHTML = '<canvas id="finalLoupeCanvas" width="260" height="190"></canvas><span class="loupeLabel">3x</span><span class="loupeHint">click to pin</span>';
    wrap.appendChild(lens);
  }

  const loupeCanvas = document.getElementById('finalLoupeCanvas');
  const lctx = loupeCanvas.getContext('2d');

  function canvasPoint(evt){
    const r = main.getBoundingClientRect();
    return {
      x: (evt.clientX - r.left) * (main.width / r.width),
      y: (evt.clientY - r.top) * (main.height / r.height),
      displayX: evt.clientX - wrap.getBoundingClientRect().left,
      displayY: evt.clientY - wrap.getBoundingClientRect().top
    };
  }

  function drawLoupeFromPoint(p){
    if(!main.width || !main.height) return;

    const sourceW = Math.max(80, Math.round(main.width / 8));
    const sourceH = Math.round(sourceW * (loupeCanvas.height / loupeCanvas.width));

    const sx = Math.max(0, Math.min(main.width - sourceW, p.x - sourceW / 2));
    const sy = Math.max(0, Math.min(main.height - sourceH, p.y - sourceH / 2));

    lctx.clearRect(0,0,loupeCanvas.width,loupeCanvas.height);
    lctx.imageSmoothingEnabled = true;
    lctx.drawImage(main, sx, sy, sourceW, sourceH, 0, 0, loupeCanvas.width, loupeCanvas.height);

    lens.style.display = 'block';

    const wrapRect = wrap.getBoundingClientRect();
    let lx = p.displayX + 28;
    let ly = p.displayY + 28;

    if(lx + 280 > wrapRect.width) lx = p.displayX - 290;
    if(ly + 210 > wrapRect.height) ly = p.displayY - 220;
    if(lx < 12) lx = 12;
    if(ly < 12) ly = 12;

    lens.style.left = lx + 'px';
    lens.style.top = ly + 'px';
  }

  function setEnabled(state){
    enabled = state;
    pinned = false;
    btn.classList.toggle('active', enabled);
    wrap.classList.toggle('enlargeMode', enabled);
    btn.textContent = enabled ? '↗ Enlarge: ON' : '↗ Enlarge';

    if(!enabled){
      lens.style.display = 'none';
    } else {
      // show centre preview immediately so the user can see the tool is active
      const r = main.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      drawLoupeFromPoint({
        x: main.width / 2,
        y: main.height / 2,
        displayX: (r.left - wr.left) + (r.width / 2),
        displayY: (r.top - wr.top) + (r.height / 2)
      });
    }
  }

  btn.addEventListener('click', function(e){
    e.preventDefault();
    e.stopImmediatePropagation();
    if(!main.width || !main.height){
      alert('Please upload an image first.');
      return;
    }
    setEnabled(!enabled);
  }, true);

  main.addEventListener('mousemove', function(e){
    if(!enabled || pinned) return;
    drawLoupeFromPoint(canvasPoint(e));
  }, true);

  main.addEventListener('click', function(e){
    if(!enabled) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    drawLoupeFromPoint(canvasPoint(e));
    pinned = !pinned;
    lens.classList.toggle('pinned', pinned);
  }, true);

  main.addEventListener('mouseleave', function(){
    if(enabled && !pinned){
      lens.style.display = 'none';
    }
  }, true);
})();

// Final guaranteed PDF report button binding
(function(){
  const reportBtn = document.getElementById('reportBtn');
  if(reportBtn){
    reportBtn.onclick = function(e){
      e.preventDefault();
      generateReportWindow();
    };
  }
})();

// Final visible colour selector binding
(function(){
  const hidden = document.getElementById('highlightColour');
  document.querySelectorAll('.colourChoice').forEach(btn => {
    btn.addEventListener('click', function(){
      if(hidden) hidden.value = this.dataset.colour || '#00a7ff';
      document.querySelectorAll('.colourChoice').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      render();
    });
  });
})();
