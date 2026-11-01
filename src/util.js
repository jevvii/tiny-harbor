import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const UP = new THREE.Vector3(0, 1, 0);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function smootherstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function noise2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

export function fbm2(x, y) {
  return noise2(x, y) * 0.56 + noise2(x * 2.1 + 4.2, y * 2.1 - 1.3) * 0.28 + noise2(x * 4.3 - 2.0, y * 4.3 + 3.1) * 0.16;
}

export function color(hex) {
  return new THREE.Color(hex);
}

export function material(hex, options = {}) {
  return new THREE.MeshStandardMaterial({
    color: hex,
    roughness: 0.9,
    metalness: 0,
    flatShading: true,
    ...options,
  });
}

export function basicMaterial(hex, options = {}) {
  return new THREE.MeshBasicMaterial({ color: hex, ...options });
}

export function shadow(obj, cast = true, receive = true) {
  obj.traverse?.((child) => {
    if (child.isMesh) {
      child.castShadow = cast;
      child.receiveShadow = receive;
    }
  });
  return obj;
}

export function addBox(parent, w, h, d, mat, x = 0, y = 0, z = 0, cast = true, receive = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

export function makeRadialTexture(stops, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, alpha] of stops) gradient.addColorStop(offset, `rgba(255,255,255,${alpha})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

let glowTextureCache;
let softTextureCache;
let starTextureCache;

export function getGlowTexture() {
  if (!glowTextureCache) {
    glowTextureCache = makeRadialTexture([
      [0, 1], [0.12, 0.72], [0.32, 0.24], [0.68, 0.045], [1, 0],
    ]);
  }
  return glowTextureCache;
}

export function getSoftTexture() {
  if (!softTextureCache) {
    softTextureCache = makeRadialTexture([
      [0, 0.62], [0.35, 0.38], [0.7, 0.1], [1, 0],
    ]);
  }
  return softTextureCache;
}

export function getStarTexture() {
  if (!starTextureCache) {
    starTextureCache = makeRadialTexture([
      [0, 1], [0.2, 0.9], [0.48, 0.22], [1, 0],
    ], 64);
  }
  return starTextureCache;
}

export function makeLabelTexture({
  line1 = 'TINY HARBOR',
  line2 = 'a small world',
  width = 512,
  height = 128,
  background = '#233c44',
  ink = '#f1e6cf',
  accent = '#d77860',
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(241,230,207,.45)';
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, width - 16, height - 16);
  ctx.fillStyle = accent;
  ctx.fillRect(width / 2 - 22, 22, 44, 3);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.font = '500 45px Georgia, "Times New Roman", serif';
  ctx.fillText(line1, width / 2, 75);
  ctx.fillStyle = 'rgba(241,230,207,.65)';
  ctx.font = 'italic 18px Georgia, "Times New Roman", serif';
  ctx.fillText(line2, width / 2, 105);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function disposeObject(root) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose?.();
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) mat?.dispose?.();
  });
}

export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function catmullEase(t) {
  t = clamp(t, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
