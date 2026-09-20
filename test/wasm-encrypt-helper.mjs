import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const processObj = process;
let Dn = null, Dfe = null, zVe = null, sg = 0, Ikt = 0, gvs = 2146435072;
let eqe = new TextEncoder();
if (!('encodeInto' in eqe)) eqe.encodeInto = function (A, e) { const t = eqe.encode(A); e.set(t); return { read: A.length, written: t.length }; };
let LPA = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
LPA.decode();
const Cq = new Array(1024).fill(undefined);
Cq.push(undefined, null, true, false);
let $Ve = Cq.length;
function Xx(A,e,t){if(void 0===t){let t=eqe.encode(A),i=e(t.length,1)>>>0;return Mke().subarray(i,i+t.length).set(t),sg=t.length,i}let i=A.length,n=e(i,1)>>>0,r=Mke(),o=0;for(;o<i;o++){let e=A.charCodeAt(o);if(e>127)break;r[n+o]=e}if(o!==i){0!==o&&(A=A.slice(o)),n=t(n,i,i=o+3*A.length,1)>>>0;let e=Mke().subarray(n+o,n+i);o+=eqe.encodeInto(A,e).written,n=t(n,i,o,1)>>>0}return sg=o,n}
function ZS(A,e){return fvs(A>>>=0,e)}
function fvs(A,e){return(Ikt+=e)>=gvs&&((LPA=new TextDecoder("utf-8",{ignoreBOM:!0,fatal:!0})).decode(),Ikt=e),LPA.decode(Mke().subarray(A,A+e))}
function ss(){return(null===Dfe||!0===Dfe.buffer.detached||void 0===Dfe.buffer.detached&&Dfe.buffer!==Dn.memory.buffer)&&(Dfe=new DataView(Dn.memory.buffer)),Dfe}
function Mke(){return(null===zVe||0===zVe.byteLength)&&(zVe=new Uint8Array(Dn.memory.buffer)),zVe}
function wE(A){return Cq[A]}
function uvs(A){A<1028||(Cq[A]=$Ve,$Ve=A)}
function Tke(A,e){return A>>>=0,Mke().subarray(A/1,A/1+e)}
function Gb(A){let e=wE(A);return uvs(A),e}
function kh(A){$Ve===Cq.length&&Cq.push(Cq.length+1);let e=$Ve;return $Ve=Cq[e],Cq[e]=A,e}
function _ir(A,e){let t=e(1*A.length,1)>>>0;return Mke().set(A,t/1),sg=A.length,t}
function wq(A){return null==A}
function XVe(A, e) {
  try { return A.apply(this, e); }
  catch (err) { Dn.__wbindgen_export(kh(err)); }
}
function Uir(){return{__proto__:null,"./qoder_auth_wasm_bg.js":{__proto__:null,__wbg_Error_2e59b1b37a9a34c3:function(A,e){return kh(Error(ZS(A,e)))},__wbg___wbindgen_is_function_49868bde5eb1e745:function(A){return"function"==typeof wE(A)},__wbg___wbindgen_is_object_40c5a80572e8f9d3:function(A){let e=wE(A);return"object"==typeof e&&null!==e},__wbg___wbindgen_is_string_b29b5c5a8065ba1a:function(A){return"string"==typeof wE(A)},__wbg___wbindgen_is_undefined_c0cca72b82b86f4d:function(A){return void 0===wE(A)},__wbg___wbindgen_throw_81fc77679af83bc6:function(A,e){throw new Error(ZS(A,e))},__wbg_call_d578befcc3145dee:function(){return XVe(function(A,e,t){return kh(wE(A).call(wE(e),wE(t)))},arguments)},__wbg_crypto_38df2bab126b63dc:function(A){return kh(wE(A).crypto)},__wbg_getRandomValues_c44a50d8cfdaebeb:function(){return XVe(function(A,e){wE(A).getRandomValues(wE(e))},arguments)},__wbg_getRandomValues_d49329ff89a07af1:function(){return XVe(function(A,e){globalThis.crypto.getRandomValues(Tke(A,e))},arguments)},__wbg_length_0c32cb8543c8e4c8:function(A){return wE(A).length},__wbg_msCrypto_bd5a034af96bcba6:function(A){return kh(wE(A).msCrypto)},__wbg_new_99cabae501c0a8a0:function(){return kh(new Map)},__wbg_new_with_length_9cedd08484b73942:function(A){return kh(new Uint8Array(A>>>0))},__wbg_node_84ea875411254db1:function(A){return kh(wE(A).node)},__wbg_now_88621c9c9a4f3ffc:function(){return Date.now()},__wbg_process_44c7a14e11e9f69e:function(A){return kh(wE(A).process)},__wbg_prototypesetcall_3e05eb9545565046:function(A,e,t){Uint8Array.prototype.set.call(Tke(A,e),wE(t))},__wbg_randomFillSync_6c25eac9869eb53c:function(){return XVe(function(A,e){wE(A).randomFillSync(Gb(e))},arguments)},__wbg_require_b4edbdcf3e2a1ef0:function(){return XVe(function(){return kh(module.require)},arguments)},__wbg_set_08463b1df38a7e29:function(A,e,t){return kh(wE(A).set(wE(e),wE(t)))},__wbg_static_accessor_GLOBAL_THIS_a1248013d790bf5f:function(){let A=typeof globalThis>"u"?null:globalThis;return wq(A)?0:kh(A)},__wbg_static_accessor_GLOBAL_f2e0f995a21329ff:function(){let A=typeof global>"u"?null:global;return wq(A)?0:kh(A)},__wbg_static_accessor_SELF_24f78b6d23f286ea:function(){let A=typeof self>"u"?null:self;return wq(A)?0:kh(A)},__wbg_static_accessor_WINDOW_59fd959c540fe405:function(){let A=typeof window>"u"?null:window;return wq(A)?0:kh(A)},__wbg_subarray_0f98d3fb634508ad:function(A,e,t){return kh(wE(A).subarray(e>>>0,t>>>0))},__wbg_versions_276b2795b1c6a219:function(A){return kh(wE(A).versions)},__wbindgen_cast_0000000000000001:function(A,e){return kh(Tke(A,e))},__wbindgen_cast_0000000000000002:function(A,e){return kh(ZS(A,e))},__wbindgen_object_clone_ref:function(A){return kh(wE(A))},__wbindgen_object_drop_ref:function(A){Gb(A)}}}}
// randomValues imports need crypto
export async function init(wasmPath) {
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, Uir());
  Dn = instance.exports;
  Dfe = null; zVe = null;
  return Dn;
}
export function getExports() { return Dn; }

export function credentialStorageEncrypt(payload, keyText) {
  let t, i;
  try {
    const g = Dn.__wbindgen_add_to_stack_pointer(-16);
    const c = Xx(payload, Dn.__wbindgen_export2, Dn.__wbindgen_export3);
    const B = sg;
    const Q = Xx(keyText, Dn.__wbindgen_export2, Dn.__wbindgen_export3);
    const E = sg;
    Dn.credential_storage_encrypt(g, c, B, Q, E);
    const n = ss().getInt32(g + 0, true), r = ss().getInt32(g + 4, true);
    const o = ss().getInt32(g + 8, true), s = ss().getInt32(g + 12, true);
    let a = n, l = r;
    if (s) { a = 0; l = 0; throw Gb(o); }
    t = a; i = l;
    return ZS(a, l);
  } finally { Dn.__wbindgen_add_to_stack_pointer(16); }
}

export function modelCacheEncrypt(plainJson, uid) {
  let t, i;
  try {
    const g = Dn.__wbindgen_add_to_stack_pointer(-16);
    const c = Xx(plainJson, Dn.__wbindgen_export2, Dn.__wbindgen_export3);
    const B = sg;
    const Q = Xx(uid, Dn.__wbindgen_export2, Dn.__wbindgen_export3);
    const E = sg;
    Dn.model_cache_encrypt(g, c, B, Q, E);
    const n = ss().getInt32(g + 0, true), r = ss().getInt32(g + 4, true);
    const o = ss().getInt32(g + 8, true), s = ss().getInt32(g + 12, true);
    let a = n, l = r;
    if (s) { a = 0; l = 0; throw Gb(o); }
    t = a; i = l;
    return ZS(a, l);
  } finally { Dn.__wbindgen_add_to_stack_pointer(16); }
}

export const WASM_PATH = fileURLToPath(new URL('../lib/qoder/wasm/qoder_auth_wasm_bg.wasm', import.meta.url));

export function modelCacheDecrypt(encryptedBase64, uid) {
  let t, i;
  try {
    const g = Dn.__wbindgen_add_to_stack_pointer(-16);
    const c = Xx(encryptedBase64, Dn.__wbindgen_export2, Dn.__wbindgen_export3);
    const B = sg;
    const Q = Xx(uid, Dn.__wbindgen_export2, Dn.__wbindgen_export3);
    const E = sg;
    Dn.model_cache_decrypt(g, c, B, Q, E);
    const n = ss().getInt32(g + 0, true), r = ss().getInt32(g + 4, true);
    const o = ss().getInt32(g + 8, true), s = ss().getInt32(g + 12, true);
    let a = n, l = r;
    if (s) { a = 0; l = 0; throw Gb(o); }
    t = a; i = l;
    return ZS(a, l);
  } finally { Dn.__wbindgen_add_to_stack_pointer(16); }
}