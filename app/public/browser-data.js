(function(global){
  const legacyKeys=new Set(['activeJobId','selectedImageId','inpaintModelChoice','textToImageModelChoice','modelManagerTab','modelInventorySort','modelCapabilitySort','registeredModelSort','studioExperience','studioMode']);
  function clearStorage(storage){
    const keys=Array.from({length:storage.length},(_,index)=>storage.key(index));
    for(const key of keys)if(key&&(key.startsWith('atelier.')||key.startsWith('atelier-')||key==='studioPanelLayout'||legacyKeys.has(key)))storage.removeItem(key);
  }
  global.AtelierBrowserData={clear(){clearStorage(global.localStorage);clearStorage(global.sessionStorage);}};
})(window);
