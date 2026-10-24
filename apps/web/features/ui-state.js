(function createAtelierStore(global) {
  const state = {
    view: 'create',
    task: localStorage.getItem('studioMode') || 'tryon',
    experience: localStorage.getItem('studioExperience') || 'simple',
    libraryFilter: 'all',
    selectedImageId: localStorage.getItem('selectedImageId') || '',
    selectedResult: '',
    activeJobId: '',
  };
  const listeners = new Set();
  const bindings={view:'currentAppView',task:'studioMode',libraryFilter:'libraryFilter',selectedResult:'studioSelectedResult',activeJobId:'activeJobId'};
  function snapshot(){
    const result={...state},app=global.AtelierApp;
    if(app){for(const [key,binding] of Object.entries(bindings))if(app[binding]!==undefined)result[key]=app[binding];
      if('current' in app)result.selectedImageId=app.current?.id||'';}
    return result;
  }
  global.AtelierStore = {
    get: snapshot,
    set(patch) {
      for(const [key,value] of Object.entries(patch)){
        const binding=bindings[key];
        if(binding&&global.AtelierApp&&binding in global.AtelierApp)global.AtelierApp[binding]=value;
        else state[key]=value;
      }
      const next=snapshot();
      for (const listener of listeners) listener(next, patch);
      return next;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
})(window);
