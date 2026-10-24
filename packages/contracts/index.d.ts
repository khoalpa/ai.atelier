export type JobStatus='queued'|'running'|'cancelling'|'completed'|'failed'|'cancelled'|'interrupted';
export type TaskKind='character'|'character-regenerate'|'tryon'|'batch-tryon'|'inpaint'|'outpaint'|'enhance'|'makeup'|'makeup-compare'|'text-to-image'|'sd35-conditioned'|'sdxl-conditioned';
export interface TaskRequest {schemaVersion:1;jobId:string;kind:TaskKind;payload:Record<string,unknown>}
export interface JobState {jobId:string;status:JobStatus;taskType:string;stage?:string;results?:ImageResult[];error?:string;resumable?:boolean;resumeMode?:'replay'|'remaining-items'}
export interface ImageAsset {id:string;url:string;name:string;sourceId?:string;sha256?:string}
export interface ImageResult extends ImageAsset {jobId:string;seed?:number;modelId?:string;sourceRevision?:string}
export interface ProjectRevision {id:string;revision:number;name:string;updatedAt:string;document:Record<string,unknown>}
export interface ApiError {ok:false;error:string;code?:string;jobId?:string}
