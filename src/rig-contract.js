import * as THREE from 'three';

// Static garment mounts in the shared body's glTF frame (Y up, front +Z).
// These preserve authored positions; they are not a skin or an animated skeleton.
const mounts={headwear:[0,3.2,-.05],facewear:[0,2.60,.59],neckwear:[0,1.48,-.03],shoulders:[0,1.40,-.03],upper:[0,1.08,.43],waist:[0,.77,-.10],lower:[0,.60,-.10],back:[0,.95,-.52],wristwear:[.80,.82,.02],handheld:[.82,1.02,.04]};
export const equipmentSlots=Object.freeze(Object.keys(mounts));
const overrides={'guard.spear':[-.98,1.02,.04],'anubis.khopesh':[.925,1.08,.16],'bard.lute':[.96,1.04,.12]};
export function mountEquipment(object,asset){
 if(asset.body_fit&&asset.body_fit!=='GGD_BODY_3.0')throw new Error('装备本体版本不匹配');
 const pivot=overrides[asset.id]||mounts[asset.slot];
 if(!pivot)throw new Error('未知装备部位：'+asset.slot);
 const socket=new THREE.Group();socket.name='mount:'+asset.id;
 socket.userData={equipmentId:asset.id,slot:asset.slot,bodyFit:'GGD_BODY_3.0',kind:'static_mount',pivot:[...pivot]};
 socket.position.fromArray(pivot);object.position.sub(socket.position);socket.add(object);return socket;
}
