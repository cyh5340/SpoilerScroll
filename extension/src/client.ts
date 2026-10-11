import { BACKEND } from './policy';
import { unavailable, type Decision, type QueueItem } from './types';
export class DeliveryError extends Error {constructor(public status: number) {super(`Backend returned ${status}`);}}
async function request(path: string, token: string, body?: unknown): Promise<Response> {
  return fetch(`${BACKEND}${path}`, {
    method:body===undefined?'GET':'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`,'X-SpoilerScroll-Extension':chrome.runtime.id},
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(5000),credentials:'omit',cache:'no-store',redirect:'error',
  });
}
export async function deliver(item: QueueItem, token: string) {
  const response=await request(item.path,token,item.body);
  if (!response.ok) throw new DeliveryError(response.status);
}
export async function getDecision(installId: string, observationId: string, token: string): Promise<Decision> {
  const response=await request(`/decisions?${new URLSearchParams({installId,observationId})}`,token);
  if (!response.ok) return unavailable;
  const result=await response.json();
  if (!result || !['pending','ready','unavailable'].includes(result.status) || typeof result.intervene!=='boolean' || !Array.isArray(result.matchedContentIds) || !result.matchedContentIds.every((id:unknown)=>typeof id==='string')) return unavailable;
  if (result.intervene && (result.status!=='ready' || typeof result.spoiler!=='string' || !result.spoiler.trim() || !['preview','full'].includes(result.scope) || !result.matchedContentIds.length)) return unavailable;
  return {status:result.status,intervene:result.intervene,spoiler:result.spoiler?.slice(0,1200),scope:result.scope,matchedContentIds:result.matchedContentIds.slice(0,20),reason:typeof result.reason==='string'?result.reason.slice(0,500):undefined};
}

export async function pairBackend(installId:string):Promise<{token:string;mode:string;history:string}> {
  const response=await request('/pair','',{installId,consent:true});
  if(!response.ok)throw new Error(`Pairing failed (${response.status}). Reload the rebuilt extension and check the backend.`);
  const data=await response.json();if(typeof data.token!=='string' || !data.token)throw new Error('Invalid pairing response');
  return data;
}
export async function prepareCandidate(body:unknown,token:string) {
  const response=await request('/candidates',token,body);
  if(!response.ok)throw new DeliveryError(response.status);
}
