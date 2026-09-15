// Shared prop library for the immersion feature. Owns the prop-pack GLB template and
// hands out clones that share read-only geometry/materials. The library lives as long
// as the current map walk session; stages only remove their borrowed objects.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

export function createPropLibrary() {
 let config = null, pack = null;
 let ready = false, loading = false, error = null, packId = null;
 let pending = null;

 async function ensure() {
  if (ready) return;
  if (pending) return pending;
  loading = true; error = null;
  pending = (async () => {
   try {
    const response = await fetch(new URL('immersion-assets.json', import.meta.url));
    if (!response.ok) throw Error('会议道具配置未能打开');
    config = await response.json();
    for (const key of Object.values(config.nodes))
     if (typeof key !== 'string' || !key) throw Error('会议道具配置节点名无效');
    // Integrity gate: the manifest carries sha256/bytes from the S1 build; a
    // truncated or corrupted GLB (partial cache, bad proxy) must fail here
    // with a clear message instead of dying later inside the parser.
    const url = new URL(config.url, document.baseURI).href;
    const bytes = await (await fetch(url)).arrayBuffer();
    if (config.bytes !== undefined && bytes.byteLength !== config.bytes)
     throw Error(`道具包字节数不符（${bytes.byteLength} ≠ ${config.bytes}），请刷新重试`);
    if (config.sha256) {
     const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
     if (digest !== config.sha256)
      throw Error('道具包校验失败（sha256 不匹配），请刷新重试');
    }
    const gltf = await new Promise((resolve, reject) => {
     new GLTFLoader().parse(bytes, '', resolve, reject);
    });
    pack = gltf.scene;
    for (const key of Object.values(config.nodes))
     if (!pack.getObjectByName(key)) throw Error('道具包缺少节点 ' + key);
    ready = true; loading = false; packId = config.pack_id;
   } catch (e) {
    loading = false; error = e.message; pending = null;
    throw e;
   }
  })();
  return pending;
 }

 return {
  ensure,
  instantiate(nodeName) {
   if (!ready || !pack) throw new Error('道具库尚未就绪');
   const source = pack.getObjectByName(nodeName);
   if (!source) throw new Error('未知道具节点 ' + nodeName);
   return source.clone(true);
  },
  chainPrototype() {
   if (!ready || !pack) throw new Error('道具库尚未就绪');
   const link = pack.getObjectByName(config.nodes.chainLink);
   const mesh = link.isMesh ? link : link.getObjectByType('Mesh') || (link.children || []).find(o => o.isMesh);
   if (!mesh) throw new Error('链节缺少网格');
   return {geometry: mesh.geometry, material: mesh.material};
  },
  nodeNames() {
   return config ? {...config.nodes} : null;
  },
  state() {
   return {ready, loading, error, packId};
  },
  dispose() {
   if (pack) {
    pack.traverse(o => {
     if (o.geometry) o.geometry.dispose();
     const materials = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
     for (const m of materials) {
      for (const value of Object.values(m)) if (value && value.isTexture) value.dispose();
      m.dispose();
     }
    });
   }
   pack = null; config = null; ready = false; loading = false; error = null; packId = null; pending = null;
  },
 };
}
