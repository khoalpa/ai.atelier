'use strict';
// Owned state: libraryFilter, librarySelected, libraryAssets
// Dependencies: $
module.exports=function createLibrary(deps){
let libraryFilter, librarySelected, libraryAssets;
function renderLibrary(){return window.AtelierLibrary?.render();}

async function loadLibraryAssets(){return window.AtelierLibrary?.load();}

async function changeLibraryRemoval(restore){
  const ids=[...librarySelected];if(!restore&&!ids.length)return;
  const message=restore?'Khôi phục tất cả mục đã xóa khỏi thư viện?':`Xóa ${ids.length} ảnh đã chọn khỏi thư viện? Tệp trên ổ đĩa được giữ nguyên. Bạn có thể khôi phục sau.`;
  if(!window.confirm(message))return;
  const button=deps.$(restore?'libraryRestoreRemoved':'libraryRemoveSelected');button.disabled=true;
  try{const response=await fetch('/api/library-remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(restore?{restore:true}:{ids})}),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể cập nhật thư viện');librarySelected.clear();await loadLibraryAssets();}
  catch(error){window.alert(error.message);}finally{button.disabled=false;}
}

function updateLibraryBulkBar(){const bar=deps.$('libraryBulkBar');if(!bar)return;bar.hidden=!librarySelected.size;deps.$('librarySelectedCount').textContent=`${librarySelected.size} ảnh đã chọn`;}
return {bindings:{get libraryFilter(){return libraryFilter;},set libraryFilter(value){libraryFilter=value;},
get librarySelected(){return librarySelected;},set librarySelected(value){librarySelected=value;},
get libraryAssets(){return libraryAssets;},set libraryAssets(value){libraryAssets=value;},
get renderLibrary(){return renderLibrary;},set renderLibrary(value){renderLibrary=value;},
get loadLibraryAssets(){return loadLibraryAssets;},set loadLibraryAssets(value){loadLibraryAssets=value;},
get changeLibraryRemoval(){return changeLibraryRemoval;},set changeLibraryRemoval(value){changeLibraryRemoval=value;},
get updateLibraryBulkBar(){return updateLibraryBulkBar;},set updateLibraryBulkBar(value){updateLibraryBulkBar=value;}},steps:[
function initialize(){
(libraryFilter = 'all');
},
function initialize(){
(librarySelected = new Set());
},
function initialize(){
(libraryAssets = []);
}
]};
};
