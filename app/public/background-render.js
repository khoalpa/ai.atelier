'use strict';
(async()=>{
  const token=location.hash.slice(1),worker=new Worker('/manual-worker.js');let current;
  worker.onmessage=async event=>{const {blob}=event.data;let {error}=event.data,data;if(!current)return;
    try{if(blob)data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Không đọc được ảnh đã dựng.'));reader.readAsDataURL(blob);});}catch(e){error=e.message;}
    try{await fetch('/api/background-render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,id:current.id,data,error})});}finally{current=null;}
  };
  worker.onerror=async()=>{if(current){await fetch('/api/background-render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,id:current.id,error:'Không nạp được bộ dựng ảnh.'})}).catch(()=>{});current=null;}};
  while(true){try{if(!current){const response=await fetch('/api/background-render?token='+encodeURIComponent(token));if(!response.ok)break;const result=await response.json();if(result.work){current=result.work;worker.postMessage({id:current.id,action:'export',document:current.document,spec:current.spec,format:current.spec?.format||'image/png'});}}}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
})();
