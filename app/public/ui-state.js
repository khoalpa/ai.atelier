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
  global.AtelierStore = {
    get() { return {...state}; },
    set(patch) {
      Object.assign(state, patch);
      for (const listener of listeners) listener({...state}, patch);
      return {...state};
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
})(window);
