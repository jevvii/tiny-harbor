import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  TAU, addBox, catmullEase, clamp, damp, fbm2, getGlowTexture, getSoftTexture,
  makeLabelTexture, material as stdMat, mulberry32, noise2, shadow,
  smoothstep, wrapAngle,
} from './util.js';

const SEGMENTS = 144;
const RINGS = 38;
const CLIFF_ANGLE = 3.72;
const BEACH_ANGLE = 0.54;
const HARBOR_ANGLE = 0.54;

function boundaryRadius(theta) {
  return 16.9
    + 1.05 * Math.sin(3 * theta + 0.6)
    + 0.67 * Math.sin(7 * theta + 1.9)
    + 0.38 * Math.cos(11 * theta + 0.2)
    + 0.28 * Math.sin(17 * theta + 1.1);
}

function dampAngle(current, target, lambda, dt) {
  const delta = wrapAngle(target - current);
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function angularWeight(theta, center, sharpness = 2) {
  const d = wrapAngle(theta - center);
  return Math.pow(Math.max(0, Math.cos(d)), sharpness);
}

function cliffWeight(theta) { return angularWeight(theta, CLIFF_ANGLE, 1.9); }
function beachWeight(theta) { return angularWeight(theta, BEACH_ANGLE, 2.4); }

function terrainHeightAt(x, z) {
  const r = Math.max(0.0001, Math.hypot(x, z));
  const theta = Math.atan2(z, x);
  const R = boundaryRadius(theta);
  const t = clamp(r / R, 0, 1.25);

  const hill = 3.25 * Math.exp(-(((x + 4.7) ** 2 + (z + 2.0) ** 2) / 34));
  const plateau = 1.15 * Math.exp(-(((x + 12.1) ** 2 + (z + 8.2) ** 2) / 12));
  const eastRoll = 1.05 * Math.exp(-(((x - 4.2) ** 2 + (z - 2.5) ** 2) / 32));
  const rolling = (noise2(x * 0.22 + 3.4, z * 0.22 - 1.7) - 0.5) * 0.7
    + (noise2(x * 0.6, z * 0.6) - 0.5) * 0.24;

  const cliff = cliffWeight(theta);
  const beach = beachWeight(theta);
  const base = 1.05 + hill + plateau + eastRoll + rolling;
  const edge = smoothstep(0.66, 1.0, t);
  const shore = 0.32 + cliff * 2.6 + plateau * 0.55;
  let h = base * (1 - edge) + shore * edge;
  h -= beach * smoothstep(0.86, 1.0, t) * 0.12;
  h += cliff * Math.sin(Math.PI * smoothstep(0.7, 1.0, t)) * 0.42;

  if (t > 1) h = THREE.MathUtils.lerp(h, -1.8, smoothstep(1, 1.2, t));
  return h;
}

function makeGableRoofGeometry(w, d, h) {
  const l0 = [-w / 2, 0, -d / 2];
  const l1 = [-w / 2, 0, d / 2];
  const r0 = [w / 2, 0, -d / 2];
  const r1 = [w / 2, 0, d / 2];
  const p0 = [0, h, -d / 2];
  const p1 = [0, h, d / 2];
  const tris = [
    l0, l1, p1, l0, p1, p0,
    r0, p0, p1, r0, p1, r1,
    l0, p0, r0,
    l1, r1, p1,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function setVertexColors(geometry, colorValue) {
  const c = new THREE.Color(colorValue);
  const count = geometry.attributes.position.count;
  const array = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    array[i * 3] = c.r;
    array[i * 3 + 1] = c.g;
    array[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(array, 3));
  return geometry;
}

function coloredMerge(parts) {
  const geos = parts.map(({ geo, color }) => {
    const flat = geo.index ? geo.toNonIndexed() : geo.clone();
    return setVertexColors(flat, color);
  });
  return mergeGeometries(geos, false);
}

function addTriangle(positions, colors, a, b, c, color) {
  positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
}

export function createWorld(scene) {
  const root = new THREE.Group();
  root.name = 'Tiny Harbor island';
  scene.add(root);

  const timeOf = { elapsed: 0 };
  const clickables = [];
  const houses = [];
  const lamps = [];
  const pointLights = [];
  const boats = [];
  const laundry = [];
  const exclusion = [];
  const pathSamples = [];

  const palette = {
    grass: ['#a9c58f', '#95b97f', '#b9cf9a', '#83aa77'].map((c) => new THREE.Color(c)),
    sand: ['#e6d6ac', '#dcc897', '#eedfba', '#d5c094'].map((c) => new THREE.Color(c)),
    rock: ['#9b968d', '#888781', '#b0a394', '#777a77'].map((c) => new THREE.Color(c)),
    wet: new THREE.Color('#b7a987'),
  };

  function colorForFace(cx, cz, h) {
    const r = Math.max(0.0001, Math.hypot(cx, cz));
    const theta = Math.atan2(cz, cx);
    const R = boundaryRadius(theta);
    const t = r / R;
    const cliff = cliffWeight(theta);
    const beach = beachWeight(theta);
    const n = fbm2(cx * 0.62 + 7.2, cz * 0.62 - 3.1);
    let paletteList = palette.grass;
    if (t > 0.7 && beach > 0.2 && h < 1.25) paletteList = palette.sand;
    if (t > 0.64 && cliff > 0.25 && h > 0.55) paletteList = palette.rock;
    if (t > 0.9 && h < 0.34) return palette.wet;
    const index = Math.min(paletteList.length - 1, Math.floor(n * paletteList.length));
    return paletteList[index];
  }

  function buildTerrainTop() {
    const ringPoints = [];
    for (let ring = 1; ring <= RINGS; ring++) {
      const row = [];
      const u = ring / RINGS;
      for (let s = 0; s < SEGMENTS; s++) {
        const theta = (s / SEGMENTS) * TAU;
        const R = boundaryRadius(theta);
        const x = Math.cos(theta) * R * u;
        const z = Math.sin(theta) * R * u;
        row.push([x, terrainHeightAt(x, z), z]);
      }
      ringPoints.push(row);
    }

    const positions = [];
    const colors = [];
    const center = [0, terrainHeightAt(0, 0), 0];

    for (let s = 0; s < SEGMENTS; s++) {
      const a = ringPoints[0][s];
      const b = ringPoints[0][(s + 1) % SEGMENTS];
      const cx = (center[0] + a[0] + b[0]) / 3;
      const cz = (center[2] + a[2] + b[2]) / 3;
      addTriangle(positions, colors, center, b, a, colorForFace(cx, cz, center[1]));
    }

    for (let ring = 0; ring < RINGS - 1; ring++) {
      const inner = ringPoints[ring];
      const outer = ringPoints[ring + 1];
      for (let s = 0; s < SEGMENTS; s++) {
        const s2 = (s + 1) % SEGMENTS;
        const a = inner[s];
        const b = inner[s2];
        const c = outer[s];
        const d = outer[s2];
        const cx1 = (a[0] + b[0] + c[0]) / 3;
        const cz1 = (a[2] + b[2] + c[2]) / 3;
        const cx2 = (b[0] + d[0] + c[0]) / 3;
        const cz2 = (b[2] + d[2] + c[2]) / 3;
        const col1 = colorForFace(cx1, cz1, c[1]);
        const col2 = colorForFace(cx2, cz2, c[1]);
        addTriangle(positions, colors, a, b, c, col1);
        addTriangle(positions, colors, b, d, c, col2);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.97, metalness: 0,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'island grass';
    root.add(mesh);
    return mesh;
  }

  function buildTerrainSides() {
    const positions = [];
    const colors = [];
    const levels = 4;
    const rows = [];
    for (let s = 0; s < SEGMENTS; s++) {
      const theta = (s / SEGMENTS) * TAU;
      const R = boundaryRadius(theta);
      const top = terrainHeightAt(Math.cos(theta) * R, Math.sin(theta) * R);
      const cliff = cliffWeight(theta);
      const beach = beachWeight(theta);
      const row = [];
      for (let l = 0; l < levels; l++) {
        const outward = [0.02, 0.34, -0.02, -0.38][l];
        const y = [top, top * 0.58 - 0.12, 0.18, -2.25][l]
          + (l > 0 ? Math.sin(theta * 11 + l * 2.1) * 0.11 * (0.3 + cliff) : 0);
        const rr = R + outward + (l === 1 ? (noise2(theta * 3.1, 1.2) - 0.5) * 0.42 : 0);
        row.push({
          p: [Math.cos(theta) * rr, y, Math.sin(theta) * rr],
          cliff, beach,
        });
      }
      rows.push(row);
    }

    const rock = palette.rock;
    const sand = palette.sand;
    for (let s = 0; s < SEGMENTS; s++) {
      const s2 = (s + 1) % SEGMENTS;
      for (let l = 0; l < levels - 1; l++) {
        const a = rows[s][l];
        const b = rows[s2][l];
        const c = rows[s][l + 1];
        const d = rows[s2][l + 1];
        const isSand = a.beach > 0.36 && a.cliff < 0.26;
        const list = isSand ? sand : rock;
        const idx = Math.min(list.length - 1, Math.floor(noise2(s * 0.4 + 3, l * 2.3) * list.length));
        const col = list[idx];
        addTriangle(positions, colors, a.p, b.p, c.p, col);
        addTriangle(positions, colors, b.p, d.p, c.p, col);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 1, metalness: 0, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'cliffs and shore';
    root.add(mesh);
    return mesh;
  }

  const terrain = buildTerrainTop();
  const cliffs = buildTerrainSides();

  // The whole world sits on a ceramic sea plinth so it reads as a small object.
  const baseMat = stdMat('#e9ddc2', { roughness: 0.84 });
  const baseSideMat = stdMat('#d9c9a8', { roughness: 0.88 });
  const baseUnderMat = stdMat('#223a43', { roughness: 0.95 });
  const rim = new THREE.Mesh(new THREE.RingGeometry(32.85, 34.35, 128), stdMat('#f2e8d1', { roughness: 0.8, side: THREE.DoubleSide }));
  rim.name = 'plinth rim';
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.045;
  rim.receiveShadow = true;
  root.add(rim);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(34.1, 33.1, 4.7, 128, 1, true), baseMat);
  base.name = 'plinth base';
  base.position.y = -2.35;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);

  const baseBand = new THREE.Mesh(new THREE.CylinderGeometry(34.16, 34.13, 0.7, 128, 1, true), baseSideMat);
  baseBand.position.y = -0.15;
  baseBand.castShadow = true;
  root.add(baseBand);

  const baseCoral = new THREE.Mesh(new THREE.CylinderGeometry(34.09, 34.0, 0.12, 128, 1, true), stdMat('#d77860', { roughness: 0.8 }));
  baseCoral.position.y = -1.15;
  root.add(baseCoral);

  const under = new THREE.Mesh(new THREE.CylinderGeometry(33.12, 26.4, 3.5, 128, 1, false), baseUnderMat);
  under.position.y = -6.3;
  under.castShadow = true;
  root.add(under);

  const nameTexture = makeLabelTexture({
    line1: 'TINY HARBOR',
    line2: 'a small world, keeping its own time',
  });
  const plaqueMat = new THREE.MeshStandardMaterial({
    map: nameTexture, roughness: 0.52, metalness: 0.16,
    emissive: '#ffe3b4', emissiveMap: nameTexture, emissiveIntensity: 0.05,
  });
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(7.7, 1.92), plaqueMat);
  const plaqueAngle = 0.64;
  plaque.position.set(Math.sin(plaqueAngle) * 34.02, -1.86, Math.cos(plaqueAngle) * 34.02);
  plaque.rotation.y = plaqueAngle;
  root.add(plaque);

  // Winding footpaths, built as slightly raised ribbons that follow the terrain.
  const pathDry = new THREE.Color('#d9c8a5');
  const pathWet = new THREE.Color('#9d9a88');
  const pathMaterial = new THREE.MeshStandardMaterial({
    color: pathDry, roughness: 0.93, metalness: 0, flatShading: true,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const puddleMaterial = new THREE.MeshStandardMaterial({
    color: '#b8d6d6', transparent: true, opacity: 0, roughness: 0.08,
    metalness: 0.2, depthWrite: false,
  });
  const puddles = [];

  const pathRoutes = [
    { width: 1.5, points: [[14.0, 9.0], [10.0, 10.5], [6.2, 9.6], [3.4, 7.0], [1.2, 4.2], [-1.8, 1.2], [-3.5, -1.0]] },
    { width: 1.15, points: [[9.8, 10.2], [12.0, 7.6], [13.2, 4.2], [12.8, 1.4]] },
    { width: 1.05, points: [[1.2, 4.2], [-1.8, 4.7], [-5.5, 4.2], [-8.6, 2.0], [-10.6, -1.4], [-12.0, -5.8]] },
    { width: 0.95, points: [[3.4, 7.0], [0.8, 8.1], [-1.4, 8.6]] },
    { width: 0.9, points: [[3.4, 7.0], [1.0, 9.6], [-0.2, 11.2]] },
    { width: 0.92, points: [[1.2, 4.2], [3.2, 1.4], [4.8, -0.8], [7.0, -2.4]] },
    { width: 0.86, points: [[-3.5, -1.0], [-2.2, -3.0], [-0.8, -5.0]] },
  ];

  function addPath({ points, width }) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    curve.curveType = 'centripetal';
    const count = 70;
    const positions = [];
    const indices = [];
    let sampleIndex = 0;
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const p = curve.getPoint(t);
      const tangent = curve.getTangent(t);
      const perp = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      for (const side of [-1, 1]) {
        const x = p.x + perp.x * (width / 2) * side;
        const z = p.z + perp.z * (width / 2) * side;
        const y = terrainHeightAt(x, z) + 0.055;
        positions.push(x, y, z);
      }
      if (i < count) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      if (i % 12 === 0) pathSamples.push({ x: p.x, z: p.z, r: width * 0.62 + 0.18 });
      sampleIndex++;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, pathMaterial);
    mesh.receiveShadow = true;
    mesh.name = 'footpath';
    root.add(mesh);

    for (let i = 0; i < 3; i++) {
      const t = 0.2 + i * 0.27;
      const p = curve.getPoint(t);
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.5 + i * 0.12, 12), puddleMaterial);
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.set(p.x + (i - 1) * 0.24, terrainHeightAt(p.x, p.z) + 0.072, p.z);
      puddle.scale.set(1.5, 1, 0.65);
      puddle.receiveShadow = false;
      puddle.visible = false;
      root.add(puddle);
      puddles.push(puddle);
    }
    return sampleIndex;
  }
  pathRoutes.forEach(addPath);

  // ---- Village ------------------------------------------------------------

  const snowRoofMaterial = new THREE.MeshStandardMaterial({
    color: '#faf6ec', roughness: 0.9, metalness: 0,
    transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const frameMat = stdMat('#5f4a3c', { roughness: 0.9 });
  const stoneMat = stdMat('#a7a092', { roughness: 0.98 });
  const doorMat = stdMat('#3f5c5a', { roughness: 0.75 });
  const ironMat = stdMat('#474e4d', { roughness: 0.65, metalness: 0.25 });
  const linenMat = stdMat('#f0e4cb', { roughness: 0.9, side: THREE.DoubleSide });
  const chimneyOrigins = [];

  const houseDefs = [
    { x: 8.5, z: 5.4, rot: 0.35, w: 2.4, d: 2.0, h: 1.7, wall: '#f2e3c8', roof: '#cb6d57', trim: '#72523f', name: 'Mira’s cottage', note: 'Kettle on. Cat asleep in the good window.', threshold: 0.05, fence: true, flowers: true },
    { x: 11.6, z: -1.7, rot: 0.2, w: 3.1, d: 2.4, h: 2.2, wall: '#e9d9b8', roof: '#55727a', trim: '#4d443c', name: 'The Gull & Oar', note: 'Pie on the chalkboard. Beds upstairs.', threshold: 0.0, two: true },
    { x: 7.8, z: 12.0, rot: 0.2, w: 2.3, d: 2.0, h: 1.55, wall: '#dce4ce', roof: '#c47a62', trim: '#5d5847', name: 'Alder house', note: 'Sea glass on every windowsill.', threshold: 0.13, flowers: true },
    { x: 4.0, z: 10.7, rot: -0.15, w: 2.2, d: 1.9, h: 1.65, wall: '#f0d9ca', roof: '#6e7f8d', trim: '#6e4d3d', name: 'Tilly’s', note: 'The blue door is never quite latched.', threshold: 0.2, fence: true },
    { x: -0.2, z: 12.0, rot: 0.1, w: 2.5, d: 2.0, h: 1.6, wall: '#e7dfc6', roof: '#9b6454', trim: '#5d5144', name: 'Wren house', note: 'A porch for watching weather arrive.', threshold: 0.28 },
    { x: 4.4, z: 4.9, rot: 0.4, w: 2.3, d: 1.95, h: 1.8, wall: '#d7dcc8', roof: '#c87d5d', trim: '#615444', name: 'Saffron’s', note: 'Something cinnamon is always cooling.', threshold: 0.36, flowers: true },
    { x: -1.8, z: 8.8, rot: 1.57, w: 2.2, d: 1.85, h: 1.55, wall: '#ecd9bf', roof: '#526e70', trim: '#55473c', name: 'The net mender', note: 'A patient chair, a patient knot.', threshold: 0.44, fence: true },
    { x: -6.4, z: 5.8, rot: 0.85, w: 2.4, d: 2.1, h: 1.7, wall: '#e8dcc8', roof: '#b36b56', trim: '#5c4b3d', name: 'Juniper house', note: 'Jam jars in the window, all labelled.', threshold: 0.52 },
    { x: -10.6, z: 4.0, rot: 2.2, w: 3.0, d: 2.3, h: 2.1, wall: '#e4d8be', roof: '#607b86', trim: '#53483d', name: 'The little school', note: 'Eight chairs. One bell. Long summers.', threshold: 0.6, two: true },
    { x: -7.4, z: 8.6, rot: 1.2, w: 2.3, d: 2.0, h: 1.6, wall: '#e6d2bc', roof: '#a86450', trim: '#5d5042', name: 'Bramble', note: 'Blackberries in the back garden.', threshold: 0.66, flowers: true },
    { x: 8.6, z: -3.4, rot: -1.0, w: 2.5, d: 2.0, h: 1.75, wall: '#e7e3ce', roof: '#527079', trim: '#5e5141', name: 'Rowan’s workshop', note: 'Sawdust, salt, and a radio playing low.', threshold: 0.72, laundry: true },
    { x: -0.5, z: -5.8, rot: 0.0, w: 2.2, d: 1.9, h: 1.55, wall: '#f0e0ca', roof: '#bf7158', trim: '#6a4f3e', name: 'The baker’s', note: 'Up before the gulls, every single day.', threshold: 0.8, fence: true },
  ];

  function buildHouse(def, index) {
    const group = new THREE.Group();
    const baseY = terrainHeightAt(def.x, def.z);
    group.position.set(def.x, baseY, def.z);
    group.rotation.y = def.rot;
    group.name = def.name;

    const wallMat = stdMat(def.wall, { roughness: 0.94 });
    const roofMat = stdMat(def.roof, { roughness: 0.84 });
    const trimMat = stdMat(def.trim, { roughness: 0.92 });
    const windowMat = new THREE.MeshStandardMaterial({
      color: '#3d4f59', emissive: '#ffbd68', emissiveIntensity: 0,
      roughness: 0.34, metalness: 0.1,
    });

    const foundation = addBox(group, def.w + 0.6, 0.8, def.d + 0.6, stoneMat, 0, 0.0, 0);
    foundation.receiveShadow = true;

    const body = addBox(group, def.w, def.h, def.d, wallMat, 0, 0.38 + def.h / 2, 0);
    if (def.two) {
      addBox(group, def.w + 0.04, 0.12, def.d + 0.04, trimMat, 0, 0.38 + def.h * 0.55, 0);
    }
    addBox(group, def.w + 0.08, 0.15, def.d + 0.08, trimMat, 0, 0.38 + def.h * 0.1, 0);

    const roofH = 0.88 + (def.two ? 0.24 : 0);
    const roofGeo = makeGableRoofGeometry(def.w + 0.76, def.d + 0.76, roofH);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 0.38 + def.h;
    roof.castShadow = true;
    roof.receiveShadow = true;
    group.add(roof);

    const snowRoof = new THREE.Mesh(roofGeo, snowRoofMaterial);
    snowRoof.position.y = 0.38 + def.h + 0.016;
    snowRoof.scale.set(1.012, 1.018, 1.012);
    snowRoof.visible = false;
    snowRoof.renderOrder = 3;
    group.add(snowRoof);

    function addWindow(x, y, z, rotY = 0, scale = 1) {
      const w = 0.42 * scale;
      const h = 0.5 * scale;
      const win = new THREE.Group();
      win.position.set(x, y, z);
      win.rotation.y = rotY;
      addBox(win, w + 0.14, h + 0.14, 0.06, trimMat, 0, 0, 0, false, false);
      addBox(win, w, h, 0.075, windowMat, 0, 0, 0.035, false, false);
      addBox(win, 0.035, h, 0.08, trimMat, 0, 0, 0.07, false, false);
      addBox(win, w, 0.035, 0.08, trimMat, 0, 0, 0.07, false, false);
      addBox(win, 0.07, h + 0.18, 0.06, trimMat, -w / 2 - 0.13, 0, -0.01, false, false);
      addBox(win, 0.07, h + 0.18, 0.06, trimMat, w / 2 + 0.13, 0, -0.01, false, false);
      group.add(win);
      if (def.flowers && y < 0.38 + def.h * 0.65 && (rotY === 0 || Math.abs(rotY) < 0.01)) {
        const box = addBox(win, w + 0.22, 0.14, 0.18, stdMat('#6f8d5c', { roughness: 1 }), 0, -h / 2 - 0.14, 0.08, false, false);
        for (let f = 0; f < 4; f++) {
          const bloom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), stdMat(f % 2 ? '#e6bf6d' : '#d77a66', { roughness: 0.8 }));
          bloom.position.set(-w * 0.32 + f * w * 0.21, 0.04, 0.08);
          win.add(bloom);
        }
        box.userData.decorative = true;
      }
      return win;
    }

    const frontZ = def.d / 2 + 0.045;
    const windowY = 0.38 + def.h * 0.59;
    addWindow(-def.w * 0.24, windowY, frontZ, 0, 1);
    addWindow(def.w * 0.24, windowY, frontZ, 0, 1);
    if (def.two) {
      addWindow(-def.w * 0.24, 0.38 + def.h * 0.8, frontZ, 0, 0.85);
      addWindow(def.w * 0.24, 0.38 + def.h * 0.8, frontZ, 0, 0.85);
    }
    addWindow(def.w / 2 + 0.045, 0.38 + def.h * 0.62, 0.1, Math.PI / 2, 0.82);
    addWindow(-def.w / 2 - 0.045, 0.38 + def.h * 0.66, -0.15, -Math.PI / 2, 0.7);

    const doorX = -def.w * 0.02;
    const doorY = 0.38 + 0.46;
    addBox(group, 0.54, 0.94, 0.06, trimMat, doorX, doorY, frontZ + 0.01, false, false);
    addBox(group, 0.42, 0.82, 0.075, doorMat, doorX, doorY, frontZ + 0.04, false, false);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), stdMat('#d8b36e', { roughness: 0.4, metalness: 0.35 }));
    knob.position.set(doorX + 0.12, doorY, frontZ + 0.085);
    group.add(knob);
    addBox(group, 0.8, 0.1, 0.32, stoneMat, doorX, 0.33, frontZ + 0.2, false, true);

    if (index % 3 === 0) {
      addBox(group, def.w * 0.58, 0.09, 0.55, trimMat, doorX, 0.38 + def.h - 0.1, frontZ + 0.27, true, true);
    }

    const chimneyX = def.w * 0.27;
    const chimneyZ = -def.d * 0.14;
    const chimneyBase = 0.38 + def.h + roofH * 0.45;
    const chimneyHeight = 0.95;
    addBox(group, 0.28, chimneyHeight, 0.28, stdMat('#b1a092', { roughness: 1 }), chimneyX, chimneyBase, chimneyZ);
    addBox(group, 0.36, 0.09, 0.36, stdMat('#6f6257', { roughness: 1 }), chimneyX, chimneyBase + chimneyHeight * 0.54, chimneyZ);

    if (def.fence) {
      const fenceMat = stdMat('#e6dac2', { roughness: 0.95 });
      const fenceZ = frontZ + 0.85;
      for (let f = 0; f < 6; f++) {
        const x = -def.w * 0.48 + f * (def.w * 0.96 / 5);
        addBox(group, 0.075, 0.58, 0.07, fenceMat, x, 0.28, fenceZ, false, true);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 4), fenceMat);
        tip.position.set(x, 0.61, fenceZ);
        group.add(tip);
      }
      addBox(group, def.w * 1.02, 0.06, 0.06, fenceMat, 0, 0.38, fenceZ, false, true);
      addBox(group, def.w * 1.02, 0.06, 0.06, fenceMat, 0, 0.2, fenceZ, false, true);
    }

    if (def.laundry) {
      const lineZ = frontZ + 0.95;
      const postMat = stdMat('#6d5844', { roughness: 1 });
      addBox(group, 0.09, 1.65, 0.09, postMat, -1.25, 0.82, lineZ);
      addBox(group, 0.09, 1.65, 0.09, postMat, 1.25, 0.82, lineZ);
      addBox(group, 2.5, 0.018, 0.018, postMat, 0, 1.61, lineZ, false, false);
      const clothColors = ['#d77f68', '#e7d5b8', '#85aaa0'];
      for (let c = 0; c < 3; c++) {
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.4), stdMat(clothColors[c], { roughness: 0.95, side: THREE.DoubleSide }));
        cloth.position.set(-0.62 + c * 0.58, 1.38, lineZ + 0.012);
        group.add(cloth);
        laundry.push({ mesh: cloth, phase: c * 1.7, baseZ: cloth.rotation.z });
      }
    }

    const chimneyTopLocal = new THREE.Vector3(chimneyX, chimneyBase + chimneyHeight / 2 + 0.08, chimneyZ);
    chimneyTopLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), def.rot);
    chimneyTopLocal.add(new THREE.Vector3(def.x, baseY, def.z));
    chimneyOrigins.push(chimneyTopLocal);

    group.userData.clickable = {
      type: 'house', name: def.name, note: def.note,
      focusDistance: 7.0 + Math.max(def.w, def.d) * 0.6,
      focusHeight: 3.2 + def.h * 0.6,
      targetHeight: def.h * 0.55,
    };

    shadow(group, true, true);
    root.add(group);
    clickables.push(group);

    const house = {
      group, def, windowMat, snowRoof, threshold: def.threshold,
      baseY, windowTarget: 0,
    };
    houses.push(house);
    exclusion.push({ x: def.x, z: def.z, r: Math.max(def.w, def.d) * 0.74 + 1.15 });
    return house;
  }

  houseDefs.forEach(buildHouse);

  // Small warm pools of light that make the village feel inhabited at night.
  const villageGlowPositions = [
    { x: 4.2, z: 6.0, threshold: 0.12, color: '#ffd08a' },
    { x: -3.2, z: 5.7, threshold: 0.27, color: '#ffc87d' },
    { x: 8.8, z: 1.0, threshold: 0.46, color: '#ffd89a' },
  ];
  for (const g of villageGlowPositions) {
    const light = new THREE.PointLight(g.color, 0, 9, 2);
    light.position.set(g.x, terrainHeightAt(g.x, g.z) + 2.2, g.z);
    root.add(light);
    pointLights.push({ light, threshold: g.threshold });
  }

  // ---- The harbor ---------------------------------------------------------

  const harborAngle = HARBOR_ANGLE;
  const pierStartR = boundaryRadius(harborAngle) - 1.35;
  const pierStart = new THREE.Vector3(
    Math.cos(harborAngle) * pierStartR, 0, Math.sin(harborAngle) * pierStartR,
  );
  const harborDir = new THREE.Vector3(Math.cos(harborAngle), 0, Math.sin(harborAngle));
  const harborPerp = new THREE.Vector3(-harborDir.z, 0, harborDir.x);
  const pierLength = 12.2;
  const pierDeckY = 0.98;
  const pierYaw = Math.atan2(harborDir.x, harborDir.z);
  const pierGroup = new THREE.Group();
  pierGroup.position.copy(pierStart);
  pierGroup.rotation.y = pierYaw;
  pierGroup.name = 'wooden pier';
  root.add(pierGroup);
  exclusion.push({ x: pierStart.x, z: pierStart.z, r: 4.8 });

  const woodA = stdMat('#8a674b', { roughness: 0.93 });
  const woodB = stdMat('#775940', { roughness: 0.94 });
  const woodC = stdMat('#a1815e', { roughness: 0.92 });
  const ropeMat = stdMat('#bdab8b', { roughness: 1 });
  const plankCount = 25;
  const plankStep = pierLength / plankCount;
  for (let i = 0; i < plankCount; i++) {
    const plank = addBox(
      pierGroup, 2.5, 0.12, plankStep - 0.035,
      i % 3 === 0 ? woodC : (i % 2 ? woodA : woodB),
      0, pierDeckY, i * plankStep + plankStep / 2,
    );
    plank.rotation.y = (i % 4 - 1.5) * 0.005;
  }
  addBox(pierGroup, 0.24, 0.24, pierLength, woodB, -0.82, pierDeckY - 0.18, pierLength / 2);
  addBox(pierGroup, 0.24, 0.24, pierLength, woodB, 0.82, pierDeckY - 0.18, pierLength / 2);
  for (let i = 0; i <= 5; i++) {
    const z = 0.3 + i * (pierLength - 0.6) / 5;
    for (const x of [-1.05, 1.05]) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 3.0, 6), woodB);
      pile.position.set(x, -0.35, z);
      pile.castShadow = true;
      pierGroup.add(pile);
      addBox(pierGroup, 0.26, 0.1, 0.26, woodC, x, 0.1, z, false, true);
    }
    addBox(pierGroup, 2.15, 0.16, 0.2, woodB, 0, 0.12, z);
  }
  for (let i = 0; i < 4; i++) {
    const z = 1.1 + i * 3.0;
    addBox(pierGroup, 0.09, 0.82, 0.09, woodB, -1.22, pierDeckY + 0.42, z);
    addBox(pierGroup, 0.09, 0.82, 0.09, woodC, 1.22, pierDeckY + 0.42, z);
  }
  addBox(pierGroup, 0.07, 0.07, pierLength - 0.9, woodC, -1.22, pierDeckY + 0.78, pierLength / 2);
  addBox(pierGroup, 0.07, 0.07, pierLength - 0.9, woodC, 1.22, pierDeckY + 0.78, pierLength / 2);

  for (const [z, x, angle] of [[2.0, -0.55, 0.5], [8.8, 0.4, -0.3], [10.6, -0.35, 1.2]]) {
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.055, 5, 12), ropeMat);
    coil.rotation.x = -Math.PI / 2;
    coil.rotation.z = angle;
    coil.position.set(x, pierDeckY + 0.095, z);
    coil.castShadow = true;
    pierGroup.add(coil);
  }
  for (const [z, x] of [[1.4, 0.8], [5.8, 0.9], [9.9, 0.75]]) {
    const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 0.55, 6), woodB);
    bollard.position.set(x, pierDeckY + 0.28, z);
    bollard.castShadow = true;
    pierGroup.add(bollard);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 6), woodC);
    cap.position.set(x, pierDeckY + 0.58, z);
    pierGroup.add(cap);
  }

  function makeCrate(size = 0.5, color = '#94714c') {
    const g = new THREE.Group();
    const bodyMat = stdMat(color, { roughness: 0.95 });
    addBox(g, size, size, size, bodyMat, 0, 0, 0);
    const band = stdMat('#5c4837', { roughness: 1 });
    addBox(g, size + 0.025, 0.055, 0.05, band, 0, size * 0.27, size / 2 + 0.012, false, true);
    addBox(g, size + 0.025, 0.055, 0.05, band, 0, -size * 0.27, size / 2 + 0.012, false, true);
    addBox(g, 0.05, 0.055, size + 0.025, band, size / 2 + 0.012, size * 0.27, 0, false, true);
    addBox(g, 0.05, 0.055, size + 0.025, band, size / 2 + 0.012, -size * 0.27, 0, false, true);
    return g;
  }
  function makeBarrel(scale = 1) {
    const g = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * scale, 0.3 * scale, 0.72 * scale, 8), woodA);
    barrel.castShadow = true;
    g.add(barrel);
    for (const y of [-0.24, 0.24]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.302 * scale, 0.302 * scale, 0.055 * scale, 8, 1, true), ironMat);
      band.position.y = y * scale;
      g.add(band);
    }
    return g;
  }

  const crateA = makeCrate(0.52, '#97744d');
  crateA.position.set(-0.55, pierDeckY + 0.31, 3.5);
  pierGroup.add(crateA);
  const crateB = makeCrate(0.38, '#a07b50');
  crateB.position.set(0.35, pierDeckY + 0.24, 3.7);
  crateB.rotation.y = 0.4;
  pierGroup.add(crateB);
  const barrelA = makeBarrel(0.9);
  barrelA.position.set(-0.62, pierDeckY + 0.4, 7.1);
  pierGroup.add(barrelA);
  const barrelB = makeBarrel(0.72);
  barrelB.position.set(0.5, pierDeckY + 0.33, 7.4);
  pierGroup.add(barrelB);

  // A ladder down to the little green boat.
  for (const x of [-0.24, 0.24]) {
    addBox(pierGroup, 0.055, 2.0, 0.055, woodB, x, pierDeckY - 0.75, 9.4);
  }
  for (let i = 0; i < 6; i++) {
    addBox(pierGroup, 0.55, 0.05, 0.05, woodC, 0, pierDeckY - 1.52 + i * 0.3, 9.4);
  }

  const flag = new THREE.Group();
  flag.position.set(0, pierDeckY + 3.0, pierLength - 0.4);
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 3.2, 5), woodC);
  flagPole.position.y = 1.5;
  flagPole.castShadow = true;
  flag.add(flagPole);
  const clothMat = stdMat('#d77860', { roughness: 0.9, side: THREE.DoubleSide });
  const flagCloth = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.5, 4, 1), clothMat);
  flagCloth.position.set(0.5, 2.8, 0);
  flagCloth.castShadow = true;
  flag.add(flagCloth);
  flag.userData.phase = 0;
  pierGroup.add(flag);
  root.updateMatrixWorld(true);

  // ---- Lamps --------------------------------------------------------------

  function createLamp(x, z, baseY, threshold, scale = 1) {
    const group = new THREE.Group();
    group.position.set(x, baseY, z);
    const postMat = stdMat('#4d4a40', { roughness: 0.82, metalness: 0.3 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#ffdca0', emissive: '#ffb45c', emissiveIntensity: 0,
      roughness: 0.26, metalness: 0.05,
    });
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * scale, 0.2 * scale, 0.1 * scale, 6), stoneMat);
    foot.position.y = 0.05 * scale;
    group.add(foot);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055 * scale, 0.075 * scale, 1.85 * scale, 6), postMat);
    post.position.y = 1.0 * scale;
    post.castShadow = true;
    group.add(post);
    addBox(group, 0.3 * scale, 0.06, 0.3 * scale, postMat, 0, 1.94 * scale, 0);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.24 * scale, 0.32 * scale, 0.24 * scale), glassMat);
    glass.position.y = 2.12 * scale;
    group.add(glass);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24 * scale, 0.2 * scale, 4), postMat);
    cap.position.y = 2.36 * scale;
    cap.rotation.y = Math.PI / 4;
    group.add(cap);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(), color: '#ffc977', transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.position.y = 2.12 * scale;
    glow.scale.setScalar(1.45 * scale);
    group.add(glow);
    root.add(group);
    const lamp = { group, glassMat, glow, threshold, scale, x, z, baseY };
    lamps.push(lamp);
    return lamp;
  }

  const pathLampSpots = [
    [12.25, 9.0, 0.03], [6.4, 10.25, 0.17], [3.2, 6.6, 0.31],
    [1.0, 4.0, 0.4], [-2.6, 4.3, 0.52], [-8.5, 1.2, 0.64],
    [-11.5, -3.8, 0.74], [-3.9, 8.0, 0.84],
  ];
  for (const [x, z, threshold] of pathLampSpots) {
    createLamp(x, z, terrainHeightAt(x, z), threshold, 0.92);
  }
  for (let i = 0; i < 3; i++) {
    const z = 2.4 + i * 3.9;
    const x = 1.17;
    const worldPos = pierStart.clone().addScaledVector(harborDir, z).addScaledVector(harborPerp, x);
    createLamp(worldPos.x, worldPos.z, pierDeckY, 0.08 + i * 0.2, 0.9);
    if (i !== 1) {
      const light = new THREE.PointLight('#ffc878', 0, 8, 2);
      light.position.set(worldPos.x, pierDeckY + 2.1, worldPos.z);
      root.add(light);
      pointLights.push({ light, threshold: 0.2 + i * 0.2 });
    }
  }
  pointLights.push({ light: createPierEndLight(), threshold: 0.34 });
  function createPierEndLight() {
    const p = pierStart.clone().addScaledVector(harborDir, pierLength - 0.5).addScaledVector(harborPerp, 0);
    const light = new THREE.PointLight('#ffca84', 0, 10, 2);
    light.position.set(p.x, pierDeckY + 2.5, p.z);
    root.add(light);
    return light;
  }

  // ---- Boats --------------------------------------------------------------

  function hullGeometry() {
    const top = [
      [-0.5, 0.34, -1.35], [0.5, 0.34, -1.35], [0.58, 0.34, -0.5],
      [0.5, 0.34, 0.6], [0, 0.34, 1.55], [-0.5, 0.34, 0.6], [-0.58, 0.34, -0.5],
    ];
    const bottom = top.map(([x, , z]) => [x * 0.5, -0.32, z * 0.88]);
    const pos = [];
    for (let i = 0; i < top.length; i++) {
      const j = (i + 1) % top.length;
      pos.push(...top[i], ...top[j], ...bottom[j]);
      pos.push(...top[i], ...bottom[j], ...bottom[i]);
    }
    for (let i = 0; i < bottom.length; i++) {
      const j = (i + 1) % bottom.length;
      pos.push(...bottom[i], ...bottom[j], 0, -0.52, 0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  function deckGeometry() {
    const top = [
      [-0.5, 0.35, -1.35], [0.5, 0.35, -1.35], [0.58, 0.35, -0.5],
      [0.5, 0.35, 0.6], [0, 0.35, 1.55], [-0.5, 0.35, 0.6], [-0.58, 0.35, -0.5],
    ];
    const pos = [];
    for (let i = 0; i < top.length; i++) {
      const j = (i + 1) % top.length;
      pos.push(0, 0.35, 0, ...top[j], ...top[i]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  const hullGeo = hullGeometry();
  const deckGeo = deckGeometry();

  function makeBoat(def, index) {
    const group = new THREE.Group();
    group.name = def.name;
    const hullMat = stdMat(def.hull, { roughness: 0.72, side: THREE.DoubleSide });
    const deckMat = stdMat('#b28b5f', { roughness: 0.9 });
    const trimMat = stdMat(def.trim, { roughness: 0.8 });
    const cabinMaterial = stdMat(def.cabin, { roughness: 0.84 });

    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.castShadow = true;
    hull.receiveShadow = true;
    group.add(hull);
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);
    addBox(group, 1.16, 0.06, 2.8, trimMat, 0, 0.38, -0.02, true, true);

    const glassMat = new THREE.MeshStandardMaterial({
      color: '#435b66', emissive: '#ffc270', emissiveIntensity: 0,
      roughness: 0.28, metalness: 0.1,
    });

    if (def.kind === 'sail') {
      addBox(group, 0.95, 0.46, 0.95, cabinMaterial, 0, 0.62, -0.5);
      addBox(group, 1.02, 0.08, 1.02, trimMat, 0, 0.88, -0.5);
      addBox(group, 0.22, 0.36, 0.05, glassMat, 0, 0.68, 0.015, false, false);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 3.15, 6), trimMat);
      mast.position.set(0, 1.95, 0.12);
      mast.castShadow = true;
      group.add(mast);
      const sailGeo = new THREE.BufferGeometry();
      sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        0.05, 0.98, 0.16, 0.05, 3.28, 0.16, 1.08, 1.22, 0.16,
      ], 3));
      sailGeo.computeVertexNormals();
      const sail = new THREE.Mesh(sailGeo, new THREE.MeshStandardMaterial({
        color: '#f2e6cc', roughness: 0.88, side: THREE.DoubleSide,
      }));
      sail.castShadow = true;
      group.add(sail);
      addBox(group, 1.0, 0.04, 0.04, trimMat, 0.5, 1.2, 0.18);
      const ropeGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 3.27, 0.16), new THREE.Vector3(0, 0.38, 1.38),
      ]);
      group.add(new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: '#b8a78a', transparent: true, opacity: 0.8 })));
    } else if (def.kind === 'fishing') {
      addBox(group, 1.0, 0.62, 1.0, cabinMaterial, 0, 0.69, -0.48);
      addBox(group, 1.07, 0.1, 1.07, trimMat, 0, 1.03, -0.48);
      addBox(group, 0.28, 0.35, 0.04, glassMat, 0.23, 0.74, 0.03, false, false);
      addBox(group, 0.28, 0.35, 0.04, glassMat, -0.23, 0.74, 0.03, false, false);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 2.0, 5), trimMat);
      mast.position.set(0, 1.45, 0.5);
      group.add(mast);
      const flagGeo = new THREE.BufferGeometry();
      flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 2.36, 0.5, 0.42, 2.22, 0.5, 0, 2.11, 0.5,
      ], 3));
      flagGeo.computeVertexNormals();
      const pennantMesh = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: '#d77860', side: THREE.DoubleSide }));
      group.add(pennantMesh);
      addBox(group, 0.36, 0.22, 0.36, woodC, 0.5, 0.51, -1.0, true, true);
    } else {
      addBox(group, 0.7, 0.32, 0.7, cabinMaterial, 0, 0.57, -0.62);
      addBox(group, 0.76, 0.08, 0.76, trimMat, 0, 0.76, -0.62);
      addBox(group, 0.2, 0.25, 0.04, glassMat, 0, 0.61, -0.255, false, false);
      for (const side of [-1, 1]) {
        const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.7, 5), woodC);
        oar.position.set(side * 0.72, 0.43, 0.15);
        oar.rotation.z = Math.PI / 2.3;
        group.add(oar);
      }
    }

    const lanternMat = new THREE.MeshStandardMaterial({
      color: '#ffd694', emissive: '#ffb65a', emissiveIntensity: 0,
      roughness: 0.35,
    });
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), lanternMat);
    lantern.position.set(0, 0.93, -1.1);
    group.add(lantern);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(), color: '#ffc675', transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.position.copy(lantern.position);
    glow.scale.setScalar(0.8);
    group.add(glow);

    const wakeMat = new THREE.MeshBasicMaterial({
      color: '#fff3dc', transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide,
    });
    const wake = new THREE.Mesh(new THREE.CircleGeometry(0.72, 14), wakeMat);
    wake.rotation.x = -Math.PI / 2;
    wake.scale.set(1.0, 2.2, 1);
    wake.position.set(0, -0.44, -1.45);
    group.add(wake);

    shadow(group, true, true);
    wake.castShadow = false;
    wake.receiveShadow = false;
    wake.raycast = () => {};
    root.add(group);
    clickables.push(group);

    const berth = pierStart.clone()
      .addScaledVector(harborDir, def.along)
      .addScaledVector(harborPerp, def.side);
    berth.y = 0;
    const dockYaw = pierYaw + (def.side < 0 ? Math.PI : 0);
    const angle = harborAngle + 0.18 + index * 0.06;
    const orbitRadius = 26.4 + index * 1.15;

    const boat = {
      group, def, index, lanternMat, glassMat, glow, wakeMat,
      berth, dockYaw, angle, orbitRadius,
      angularSpeed: 0.044 - index * 0.004,
      state: 'docked', timer: 4.1 + index * 2.1,
      startPos: berth.clone(), targetPos: berth.clone(),
      currentPos: berth.clone(), yaw: dockYaw, targetYaw: dockYaw,
      cooldown: 0, phase: index * 2.4, moveAmount: 0,
      focusHeight: 4.6, focusDistance: 8.8,
    };
    boat.timer = [4.2, 6.4, 8.5][index];
    boat.group.position.copy(berth);
    boat.group.position.y = 0.48;
    boat.group.rotation.y = dockYaw;
    group.userData.clickable = {
      type: 'boat', name: def.name, note: def.note,
      focusDistance: 8.8, focusHeight: 4.4, targetHeight: 0.8, follow: true,
    };
    boats.push(boat);
    boat.timer = [4.2, 6.4, 8.5][index];
    return boat;
  }

  const boatDefs = [
    { name: 'Nell', note: 'Canvas sail, copper kettle, no particular hurry.', kind: 'sail', hull: '#d97c62', trim: '#77553e', cabin: '#e8dcc4', along: 9.0, side: 2.18 },
    { name: 'Pip', note: 'Always first out and last back, with the day’s catch.', kind: 'fishing', hull: '#6d9a91', trim: '#54483c', cabin: '#f0e4ca', along: 5.7, side: 2.18 },
    { name: 'Barnacle', note: 'A little green boat that knows every shallow.', kind: 'dinghy', hull: '#dfd6b9', trim: '#4d6f74', cabin: '#6c9b95', along: 7.9, side: -2.18 },
  ];
  boatDefs.forEach(makeBoat);

  // ---- Lighthouse ---------------------------------------------------------

  const lighthousePos = new THREE.Vector3(-12.2, terrainHeightAt(-12.2, -8.2), -8.2);
  const lighthouse = new THREE.Group();
  lighthouse.position.copy(lighthousePos);
  lighthouse.rotation.y = 0.7;
  lighthouse.name = 'Old Wick lighthouse';
  root.add(lighthouse);
  exclusion.push({ x: lighthousePos.x, z: lighthousePos.z, r: 5.2 });

  addBox(lighthouse, 5.2, 0.7, 5.2, stoneMat, 0, 0.05, 0);
  const lhPlinth = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.65, 0.9, 8), stdMat('#898b83', { roughness: 1 }));
  lhPlinth.position.y = 0.72;
  lhPlinth.castShadow = true;
  lhPlinth.receiveShadow = true;
  lighthouse.add(lhPlinth);
  addBox(lighthouse, 3.0, 0.45, 3.0, stoneMat, 0, 1.1, 0);

  const lhCream = stdMat('#f0e5ce', { roughness: 0.82 });
  const lhCoral = stdMat('#ce6e59', { roughness: 0.82 });
  const towerSections = 5;
  for (let i = 0; i < towerSections; i++) {
    const h = 1.05;
    const rb = 1.42 - i * 0.12;
    const rt = 1.42 - (i + 1) * 0.12;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 8), i % 2 ? lhCoral : lhCream);
    seg.position.y = 1.45 + h / 2 + i * h;
    seg.castShadow = true;
    seg.receiveShadow = true;
    lighthouse.add(seg);
  }
  const lhDoor = addBox(lighthouse, 0.52, 1.0, 0.08, doorMat, 0, 2.0, 1.35, false, false);
  addBox(lighthouse, 0.62, 0.12, 0.16, stoneMat, 0, 1.48, 1.4, false, true);
  const lhWinMat = new THREE.MeshStandardMaterial({
    color: '#3e5760', emissive: '#ffc16d', emissiveIntensity: 0, roughness: 0.3,
  });
  addBox(lighthouse, 0.2, 0.38, 0.08, lhWinMat, 0, 4.1, 1.12, false, false);
  addBox(lighthouse, 0.16, 0.28, 0.08, lhWinMat, 0, 5.65, 0.98, false, false);
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.03, 0.16, 8), stdMat('#59635f', { roughness: 0.8 }));
  gallery.position.y = 6.82;
  gallery.castShadow = true;
  lighthouse.add(gallery);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.62, 4), ironMat);
    post.position.set(Math.cos(a) * 1.04, 7.2, Math.sin(a) * 1.04);
    lighthouse.add(post);
  }
  const rail = new THREE.Mesh(new THREE.TorusGeometry(1.04, 0.025, 4, 32), ironMat);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = 7.49;
  lighthouse.add(rail);

  const lanternMat = new THREE.MeshStandardMaterial({
    color: '#ffdc9f', emissive: '#ffbc63', emissiveIntensity: 0.2,
    transparent: true, opacity: 0.88, roughness: 0.24, metalness: 0.05,
  });
  const lanternRoom = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.82, 8), lanternMat);
  lanternRoom.position.y = 7.36;
  lighthouse.add(lanternRoom);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    addBox(lighthouse, 0.055, 0.88, 0.055, ironMat, Math.cos(a) * 0.63, 7.36, Math.sin(a) * 0.63, false, false);
  }
  const lhRoof = new THREE.Mesh(new THREE.ConeGeometry(0.92, 0.82, 8), stdMat('#475f63', { roughness: 0.78 }));
  lhRoof.position.y = 8.15;
  lhRoof.castShadow = true;
  lighthouse.add(lhRoof);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), stdMat('#d9b56e', { roughness: 0.45, metalness: 0.35 }));
  finial.position.y = 8.63;
  lighthouse.add(finial);

  const beamFadeShader = (length, color) => ({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
      uLength: { value: length },
    },
    vertexShader: /* glsl */`
      uniform float uLength;
      varying float vFade;
      void main() {
        vFade = smoothstep(uLength, 3.0, position.x);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vFade;
      void main() {
        gl_FragColor = vec4(uColor, vFade * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beamMat = new THREE.ShaderMaterial(beamFadeShader(52, '#ffe6a7'));
  const beamGeo = new THREE.ConeGeometry(4.6, 52, 24, 1, true);
  beamGeo.rotateZ(Math.PI / 2);
  beamGeo.translate(26, 0, 0);
  beamGeo.rotateZ(-0.09);
  const beamGroup = new THREE.Group();
  beamGroup.position.y = 7.4;
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.renderOrder = 4;
  beamGroup.add(beam);
  const beamCore = new THREE.Mesh(
    new THREE.ConeGeometry(1.7, 46, 18, 1, true),
    new THREE.ShaderMaterial(beamFadeShader(46, '#fff2d0')),
  );
  beamCore.geometry.rotateZ(Math.PI / 2);
  beamCore.geometry.translate(23, 0, 0);
  beamCore.geometry.rotateZ(-0.09);
  beamCore.renderOrder = 4;
  beamGroup.add(beamCore);
  lighthouse.add(beamGroup);

  const lhGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getGlowTexture(), color: '#ffd28a', transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  lhGlow.position.y = 7.4;
  lhGlow.scale.setScalar(4.4);
  lighthouse.add(lhGlow);
  const lighthouseLight = new THREE.PointLight('#ffd28a', 0, 55, 2);
  lighthouseLight.position.y = 7.4;
  lighthouse.add(lighthouseLight);
  lighthouse.userData.clickable = {
    type: 'lighthouse', name: 'Old Wick lighthouse', note: 'It still sweeps the water, even on clear nights.',
    focusDistance: 16.0, focusHeight: 7.2, targetHeight: 5.8,
  };
  clickables.push(lighthouse);
  shadow(lighthouse, true, true);
  beam.castShadow = false;
  beam.receiveShadow = false;
  beam.raycast = () => {};
  beamCore.castShadow = false;
  beamCore.receiveShadow = false;
  beamCore.raycast = () => {};
  lhGlow.raycast = () => {};
  lhGlow.visible = true;

  // ---- Windmill -----------------------------------------------------------

  const windmillPos = new THREE.Vector3(-4.8, terrainHeightAt(-4.8, -2.2), -2.2);
  const windmill = new THREE.Group();
  windmill.position.copy(windmillPos);
  windmill.rotation.y = 0.95;
  windmill.name = 'The miller’s windmill';
  root.add(windmill);
  exclusion.push({ x: windmillPos.x, z: windmillPos.z, r: 4.4 });

  const millStone = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 2.2, 0.55, 8), stoneMat);
  millStone.position.y = 0.24;
  millStone.castShadow = true;
  millStone.receiveShadow = true;
  windmill.add(millStone);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.03, 1.52, 5.35, 8), stdMat('#efe4cc', { roughness: 0.9 }));
  tower.position.y = 3.05;
  tower.castShadow = true;
  tower.receiveShadow = true;
  windmill.add(tower);
  for (const y of [1.5, 3.15, 4.75]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.52 - (y - 1.5) * 0.09, 0.035, 4, 16), stdMat('#796048', { roughness: 0.9 }));
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    windmill.add(band);
  }
  addBox(windmill, 0.5, 0.95, 0.08, doorMat, 0, 0.95, 1.4, false, false);
  const millWindowMat = new THREE.MeshStandardMaterial({
    color: '#3f555e', emissive: '#ffc26b', emissiveIntensity: 0, roughness: 0.3,
  });
  addBox(windmill, 0.28, 0.42, 0.08, millWindowMat, 0, 2.2, 1.32, false, false);
  addBox(windmill, 0.26, 0.38, 0.08, millWindowMat, 0, 4.0, 1.02, false, false);
  const millCap = new THREE.Mesh(new THREE.ConeGeometry(1.22, 1.25, 8), stdMat('#4e6a6b', { roughness: 0.82 }));
  millCap.position.y = 6.15;
  millCap.castShadow = true;
  windmill.add(millCap);
  const millFinial = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), stdMat('#d9b56e', { roughness: 0.4, metalness: 0.3 }));
  millFinial.position.y = 6.85;
  windmill.add(millFinial);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.52, 8), stdMat('#7d6047', { roughness: 0.85 }));
  hub.rotation.x = Math.PI / 2;
  hub.position.set(0, 5.18, 1.46);
  windmill.add(hub);
  const bladeWheel = new THREE.Group();
  bladeWheel.position.set(0, 5.18, 1.56);
  windmill.add(bladeWheel);
  const bladeWood = stdMat('#806347', { roughness: 0.92 });
  const sailLinen = stdMat('#f2e7ce', { roughness: 0.92, side: THREE.DoubleSide });
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i / 4) * TAU;
    const spar = addBox(arm, 0.1, 2.65, 0.08, bladeWood, 0, 1.45, 0);
    spar.castShadow = true;
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.5), sailLinen);
    sail.position.set(0.29, 1.73, 0.02);
    arm.add(sail);
    for (const y of [1.28, 1.73, 2.18]) {
      addBox(arm, 0.62, 0.045, 0.035, bladeWood, 0.29, y, 0.02, false, false);
    }
    bladeWheel.add(arm);
  }
  const windmillWindows = millWindowMat;
  windmill.userData.clickable = {
    type: 'windmill', name: 'The miller’s windmill', note: 'Four sails, one slow creak, flour for the whole island.',
    focusDistance: 14.5, focusHeight: 8.0, targetHeight: 5.0,
  };
  clickables.push(windmill);
  shadow(windmill, true, true);

  // ---- Trees, grass, flowers, rocks --------------------------------------

  const natureRng = mulberry32(4417);
  function nearPath(x, z, margin) {
    for (const p of pathSamples) {
      const dx = x - p.x;
      const dz = z - p.z;
      if (dx * dx + dz * dz < (p.r + margin) * (p.r + margin)) return true;
    }
    return false;
  }
  function nearObject(x, z, margin) {
    for (const e of exclusion) {
      const dx = x - e.x;
      const dz = z - e.z;
      if (dx * dx + dz * dz < (e.r + margin) * (e.r + margin)) return true;
    }
    return false;
  }
  function randomLandPoint(minRadius = 2.2, edgeFactor = 0.92) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const theta = natureRng() * TAU;
      const R = boundaryRadius(theta);
      const radius = minRadius + Math.sqrt(natureRng()) * (R * edgeFactor - minRadius);
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      const h = terrainHeightAt(x, z);
      if (h < 0.55) continue;
      if (beachWeight(theta) > 0.44 && radius > R * 0.72) continue;
      return { x, z, y: h, theta, radius, R };
    }
    return null;
  }

  const treePositions = [];
  const placedTrees = [];
  for (let attempt = 0; attempt < 650 && placedTrees.length < 66; attempt++) {
    const p = randomLandPoint(2.5, 0.9);
    if (!p) continue;
    if (nearObject(p.x, p.z, 0.9) || nearPath(p.x, p.z, 0.55)) continue;
    let tooClose = false;
    for (const t of treePositions) {
      if ((t.x - p.x) ** 2 + (t.z - p.z) ** 2 < 2.4) { tooClose = true; break; }
    }
    if (tooClose) continue;
    treePositions.push({ x: p.x, z: p.z });
    placedTrees.push({
      x: p.x, z: p.z, y: p.y,
      scale: 0.66 + natureRng() * 0.7,
      yaw: natureRng() * TAU,
      phase: natureRng() * TAU,
      type: natureRng() < 0.46 ? 'pine' : 'round',
      tint: 0.9 + natureRng() * 0.18,
    });
  }

  function buildTreeGeometries() {
    const trunk = new THREE.CylinderGeometry(0.12, 0.19, 1.15, 5);
    trunk.translate(0, 0.575, 0);
    const pine = coloredMerge([
      { geo: trunk.clone(), color: '#755e4a' },
      { geo: new THREE.ConeGeometry(1.2, 1.9, 7).translate(0, 1.75, 0), color: '#72956b' },
      { geo: new THREE.ConeGeometry(0.94, 1.55, 7).translate(0, 2.55, 0), color: '#82a776' },
      { geo: new THREE.ConeGeometry(0.64, 1.25, 6).translate(0, 3.28, 0), color: '#90b381' },
    ]);
    const round = coloredMerge([
      { geo: trunk.clone(), color: '#7a614d' },
      { geo: new THREE.IcosahedronGeometry(1.0, 0).scale(1.15, 1.05, 1.15).translate(0, 2.18, 0), color: '#86a976' },
      { geo: new THREE.IcosahedronGeometry(0.78, 0).scale(0.9, 1.0, 0.9).translate(0.55, 1.78, 0.18), color: '#93b47f' },
      { geo: new THREE.IcosahedronGeometry(0.7, 0).scale(1, 0.9, 1).translate(-0.5, 1.72, -0.14), color: '#789e70' },
    ]);
    return { pine, round };
  }
  const treeGeos = buildTreeGeometries();
  const treeMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.98, metalness: 0,
  });
  const pines = placedTrees.filter((t) => t.type === 'pine');
  const rounds = placedTrees.filter((t) => t.type === 'round');
  const pineMesh = new THREE.InstancedMesh(treeGeos.pine, treeMaterial, pines.length);
  const roundMesh = new THREE.InstancedMesh(treeGeos.round, treeMaterial, rounds.length);
  pineMesh.castShadow = true;
  pineMesh.receiveShadow = true;
  roundMesh.castShadow = true;
  roundMesh.receiveShadow = true;
  pineMesh.frustumCulled = false;
  roundMesh.frustumCulled = false;
  root.add(pineMesh, roundMesh);
  const treeDummy = new THREE.Object3D();
  const instanceTint = new THREE.Color();
  pines.forEach((tree, i) => {
    pineMesh.setColorAt(i, instanceTint.setRGB(tree.tint, tree.tint, tree.tint));
  });
  rounds.forEach((tree, i) => {
    roundMesh.setColorAt(i, instanceTint.setRGB(tree.tint, tree.tint, tree.tint));
  });
  if (pineMesh.instanceColor) pineMesh.instanceColor.needsUpdate = true;
  if (roundMesh.instanceColor) roundMesh.instanceColor.needsUpdate = true;

  function updateTreeInstances(time, wind) {
    let pi = 0;
    let ri = 0;
    for (const tree of placedTrees) {
      const sway = Math.sin(time * 0.72 + tree.phase) * 0.018 * wind
        + Math.sin(time * 1.4 + tree.phase * 1.7) * 0.006 * wind;
      treeDummy.position.set(tree.x, tree.y, tree.z);
      treeDummy.rotation.set(sway, tree.yaw, sway * 0.7);
      treeDummy.scale.setScalar(tree.scale);
      treeDummy.updateMatrix();
      if (tree.type === 'pine') pineMesh.setMatrixAt(pi++, treeDummy.matrix);
      else roundMesh.setMatrixAt(ri++, treeDummy.matrix);
    }
    pineMesh.instanceMatrix.needsUpdate = true;
    roundMesh.instanceMatrix.needsUpdate = true;
  }
  updateTreeInstances(0, 0.4);

  // Grass tufts use a handful of simple blades merged into one instanced mesh.
  const grassParts = [];
  const grassColors = ['#8cb276', '#7da36c', '#9cbd84', '#6e9766'];
  for (let i = 0; i < 5; i++) {
    const blade = new THREE.ConeGeometry(0.055, 0.65 + (i % 2) * 0.18, 3);
    blade.translate(0, 0.34, 0);
    blade.rotateZ((i - 2) * 0.22);
    blade.rotateY(i * 1.35);
    blade.translate((i - 2) * 0.08, 0, (i % 2 - 0.5) * 0.1);
    grassParts.push({ geo: blade, color: grassColors[i % grassColors.length] });
  }
  const grassGeo = coloredMerge(grassParts);
  const grassMat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide,
  });
  const grassTufts = [];
  for (let attempt = 0; attempt < 1200 && grassTufts.length < 720; attempt++) {
    const p = randomLandPoint(1.8, 0.94);
    if (!p) continue;
    if (nearObject(p.x, p.z, 0.08) || nearPath(p.x, p.z, 0.12)) continue;
    grassTufts.push({
      x: p.x, z: p.z, y: p.y + 0.01,
      scale: 0.55 + natureRng() * 0.9,
      yaw: natureRng() * TAU,
      phase: natureRng() * TAU,
      tint: 0.83 + natureRng() * 0.25,
    });
  }
  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, grassTufts.length);
  grassMesh.castShadow = false;
  grassMesh.receiveShadow = true;
  grassMesh.frustumCulled = false;
  root.add(grassMesh);
  const grassDummy = new THREE.Object3D();
  grassTufts.forEach((tuft, i) => {
    grassMesh.setColorAt(i, instanceTint.setRGB(tuft.tint, tuft.tint, tuft.tint));
  });
  if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;

  function updateGrass(time, wind) {
    for (let i = 0; i < grassTufts.length; i++) {
      const tuft = grassTufts[i];
      const sway = (Math.sin(time * 1.55 + tuft.phase) * 0.13 + Math.sin(time * 2.7 + tuft.phase * 1.8) * 0.035) * wind;
      grassDummy.position.set(tuft.x, tuft.y, tuft.z);
      grassDummy.rotation.set(sway, tuft.yaw, sway * 0.6);
      grassDummy.scale.setScalar(tuft.scale);
      grassDummy.updateMatrix();
      grassMesh.setMatrixAt(i, grassDummy.matrix);
    }
    grassMesh.instanceMatrix.needsUpdate = true;
  }
  updateGrass(0, 0.4);

  // Tiny flowers scattered through the grass.
  const flowerGeo = new THREE.IcosahedronGeometry(0.065, 0);
  const flowerMat = new THREE.MeshStandardMaterial({ vertexColors: false, flatShading: true, roughness: 0.9 });
  const flowerSpots = [];
  for (let attempt = 0; attempt < 450 && flowerSpots.length < 110; attempt++) {
    const p = randomLandPoint(2.0, 0.82);
    if (!p) continue;
    if (nearObject(p.x, p.z, 0.05) || nearPath(p.x, p.z, 0.1)) continue;
    flowerSpots.push(p);
  }
  const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerSpots.length);
  const flowerColors = [new THREE.Color('#e7b96f'), new THREE.Color('#d97b68'), new THREE.Color('#f1e5c7'), new THREE.Color('#b7a4cf')];
  const flowerDummy = new THREE.Object3D();
  flowerSpots.forEach((p, i) => {
    flowerDummy.position.set(p.x, p.y + 0.23, p.z);
    flowerDummy.scale.setScalar(0.7 + natureRng() * 0.7);
    flowerDummy.updateMatrix();
    flowerMesh.setMatrixAt(i, flowerDummy.matrix);
    flowerMesh.setColorAt(i, flowerColors[Math.floor(natureRng() * flowerColors.length)]);
  });
  flowerMesh.instanceMatrix.needsUpdate = true;
  if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
  flowerMesh.castShadow = false;
  root.add(flowerMesh);

  // Boulders along the cliffs and shallows.
  const rockMesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }),
    36,
  );
  const rockDummy = new THREE.Object3D();
  const rockPalette = [new THREE.Color('#8e8b82'), new THREE.Color('#a29a8c'), new THREE.Color('#777b79'), new THREE.Color('#b1a696')];
  for (let i = 0; i < 36; i++) {
    const theta = natureRng() * TAU;
    const R = boundaryRadius(theta);
    const radius = R - 1.4 + natureRng() * 3.8;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    const y = Math.max(0.03, terrainHeightAt(x, z) + 0.12);
    const scale = 0.18 + Math.pow(natureRng(), 2) * 1.25;
    rockDummy.position.set(x, y, z);
    rockDummy.rotation.set(natureRng() * TAU, natureRng() * TAU, natureRng() * TAU);
    rockDummy.scale.set(scale * (0.8 + natureRng() * 0.6), scale * (0.5 + natureRng() * 0.5), scale);
    rockDummy.updateMatrix();
    rockMesh.setMatrixAt(i, rockDummy.matrix);
    rockMesh.setColorAt(i, rockPalette[Math.floor(natureRng() * rockPalette.length)]);
  }
  rockMesh.instanceMatrix.needsUpdate = true;
  if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
  rockMesh.name = 'boulders';
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  root.add(rockMesh);

  // ---- Beach daydreams ----------------------------------------------------

  {
    const ux = 12.4;
    const uz = 10.6;
    const uy = terrainHeightAt(ux, uz);
    const umbrella = new THREE.Group();
    umbrella.position.set(ux, uy, uz);
    umbrella.rotation.y = -0.4;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.35, 6), stdMat('#8c7559', { roughness: 0.9 }));
    pole.position.y = 1.18;
    pole.castShadow = true;
    umbrella.add(pole);
    const canopyPositions = [];
    const canopyColors = [];
    const canopyColA = new THREE.Color('#d77860');
    const canopyColB = new THREE.Color('#f1e4ca');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const b = ((i + 1) / 8) * TAU;
      const p1 = [0, 2.48, 0];
      const p2 = [Math.cos(a) * 1.32, 2.0, Math.sin(a) * 1.32];
      const p3 = [Math.cos(b) * 1.32, 2.0, Math.sin(b) * 1.32];
      canopyPositions.push(...p1, ...p2, ...p3);
      const c = i % 2 ? canopyColA : canopyColB;
      for (let k = 0; k < 3; k++) canopyColors.push(c.r, c.g, c.b);
    }
    const canopyGeo = new THREE.BufferGeometry();
    canopyGeo.setAttribute('position', new THREE.Float32BufferAttribute(canopyPositions, 3));
    canopyGeo.setAttribute('color', new THREE.Float32BufferAttribute(canopyColors, 3));
    canopyGeo.computeVertexNormals();
    const canopy = new THREE.Mesh(canopyGeo, new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.92, side: THREE.DoubleSide,
    }));
    canopy.castShadow = true;
    umbrella.add(canopy);
    root.add(umbrella);

    const towelMat = stdMat('#e4b4a2', { roughness: 0.96, side: THREE.DoubleSide });
    for (let i = 0; i < 2; i++) {
      const tx = ux - 1.35 + i * 1.15;
      const tz = uz + 0.2 + i * 0.45;
      const towel = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.45), towelMat);
      towel.rotation.x = -Math.PI / 2;
      towel.rotation.z = 0.2 + i * 0.4;
      towel.position.set(tx, terrainHeightAt(tx, tz) + 0.065, tz);
      root.add(towel);
      addBox(root, 0.5, 0.1, 0.22, stdMat('#e7ddc9', { roughness: 0.95 }), tx + 0.1, terrainHeightAt(tx, tz) + 0.14, tz - 0.9);
    }

    // A little rowboat pulled up above the tide line.
    const beached = new THREE.Group();
    const bx = 10.3;
    const bz = 13.2;
    beached.position.set(bx, terrainHeightAt(bx, bz) + 0.44, bz);
    beached.rotation.set(0, -0.8, 0.12);
    const beachedHull = new THREE.Mesh(hullGeo, stdMat('#cf8a6d', { roughness: 0.8, side: THREE.DoubleSide }));
    beachedHull.scale.setScalar(0.9);
    beachedHull.castShadow = true;
    beached.add(beachedHull);
    const beachedDeck = new THREE.Mesh(deckGeo, stdMat('#b28b5f', { roughness: 0.9 }));
    beachedDeck.scale.setScalar(0.9);
    beached.add(beachedDeck);
    for (const side of [-1, 1]) {
      const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 5), woodC);
      oar.rotation.z = Math.PI / 2;
      oar.rotation.y = side * 0.2;
      oar.position.set(side * 0.65, 0.48, 0.3);
      beached.add(oar);
    }
    root.add(beached);
    exclusion.push({ x: bx, z: bz, r: 2.2 });
    exclusion.push({ x: ux, z: uz, r: 2.0 });
  }

  // ---- Clouds -------------------------------------------------------------

  function makeCloudGeometry(seed) {
    const rng = mulberry32(seed);
    const parts = [];
    const count = 5 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      const puff = new THREE.IcosahedronGeometry(0.8 + rng() * 0.8, 1);
      puff.scale(1.2 + rng() * 0.9, 0.62 + rng() * 0.34, 0.9 + rng() * 0.5);
      puff.translate((i - count / 2) * 0.95 + rng() * 0.4, rng() * 0.45, (rng() - 0.5) * 1.2);
      parts.push(puff);
    }
    return mergeGeometries(parts, false);
  }
  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: '#f6f0e2', emissive: '#ded7c8', emissiveIntensity: 0.14,
    roughness: 1, metalness: 0, flatShading: true,
  });
  const cloudGeos = [makeCloudGeometry(3), makeCloudGeometry(19), makeCloudGeometry(31)];
  const clouds = [];
  const cloudRng = mulberry32(202);
  for (let i = 0; i < 13; i++) {
    const mesh = new THREE.Mesh(cloudGeos[i % cloudGeos.length], cloudMaterial);
    mesh.name = 'cloud';
    const angle = cloudRng() * TAU;
    // Keep clouds beyond the camera's orbit so none of them ever clip the lens
    // as it drifts around the island.
    const radius = 118 + cloudRng() * 64;
    const y = 17 + cloudRng() * 14;
    mesh.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    mesh.scale.setScalar(1.0 + cloudRng() * 0.8);
    mesh.rotation.y = cloudRng() * TAU;
    mesh.castShadow = false;
    root.add(mesh);
    clouds.push({
      mesh, angle, radius, y,
      speed: (0.0025 + cloudRng() * 0.006) * (cloudRng() < 0.5 ? -1 : 1),
      baseScale: mesh.scale.x,
    });
  }

  // ---- Chimney smoke ------------------------------------------------------

  const smokePuffs = [];
  const smokeRng = mulberry32(88);
  for (const origin of chimneyOrigins) {
    for (let i = 0; i < 5; i++) {
      smokePuffs.push({
        origin,
        phase: smokeRng(),
        speed: 0.055 + smokeRng() * 0.035,
        drift: (smokeRng() - 0.5) * 0.35,
        wobble: smokeRng() * TAU,
        size: 0.55 + smokeRng() * 0.4,
      });
    }
  }
  const smokePositions = new Float32Array(smokePuffs.length * 3);
  const smokeAlpha = new Float32Array(smokePuffs.length);
  const smokeSizes = new Float32Array(smokePuffs.length);
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
  smokeGeo.setAttribute('aAlpha', new THREE.BufferAttribute(smokeAlpha, 1));
  smokeGeo.setAttribute('aSize', new THREE.BufferAttribute(smokeSizes, 1));
  const smokeMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: getSoftTexture() },
      uColor: { value: new THREE.Color('#efe9df') },
    },
    vertexShader: /* glsl */`
      attribute float aAlpha;
      attribute float aSize;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (260.0 / -mv.z);
        gl_PointSize = min(gl_PointSize, 80.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(uColor, tex.a * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const smoke = new THREE.Points(smokeGeo, smokeMat);
  smoke.frustumCulled = false;
  smoke.renderOrder = 5;
  root.add(smoke);

  // ---- Gulls --------------------------------------------------------------

  const gullWhite = stdMat('#f4efe2', { roughness: 0.9, side: THREE.DoubleSide, flatShading: true });
  const gullGrey = stdMat('#aab5b4', { roughness: 0.92, flatShading: true });
  const gullOrange = stdMat('#d99a62', { roughness: 0.9 });
  const gullRng = mulberry32(515);
  const gulls = [];

  function wingGeometry(sign) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      sign * 1.12, 0.02, 0.27,
      sign * 0.74, 0, -0.43,
      0, 0, 0,
      sign * 0.74, 0, -0.43,
      sign * 0.94, 0.015, -0.12,
    ], 3));
    geo.computeVertexNormals();
    return geo;
  }
  function makeGull(i) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), gullWhite);
    body.scale.set(0.8, 0.65, 2.0);
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 5, 4), gullWhite);
    head.position.set(0, 0.08, 0.3);
    group.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 4), gullOrange);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.08, 0.44);
    group.add(beak);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 4), gullGrey);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 0, -0.33);
    group.add(tail);
    const wingR = new THREE.Mesh(wingGeometry(1), gullWhite);
    wingR.position.set(0.08, 0.06, 0.03);
    group.add(wingR);
    const wingL = new THREE.Mesh(wingGeometry(-1), gullWhite);
    wingL.position.set(-0.08, 0.06, 0.03);
    group.add(wingL);
    group.scale.setScalar(0.9 + gullRng() * 0.24);
    root.add(group);
    const gull = {
      group, wingR, wingL,
      radius: 10 + gullRng() * 13,
      height: 13 + gullRng() * 8,
      speed: 0.06 + gullRng() * 0.09,
      angle: gullRng() * TAU,
      phase: gullRng() * TAU,
      flap: 2.1 + gullRng() * 1.5,
    };
    gulls.push(gull);
    return gull;
  }
  for (let i = 0; i < 7; i++) makeGull(i);

  // ---- Fish ---------------------------------------------------------------

  const fishRng = mulberry32(303);
  const fishes = [];
  const splashMatBase = new THREE.MeshBasicMaterial({
    color: '#fff1d4', transparent: true, opacity: 0, depthWrite: false,
    side: THREE.DoubleSide,
  });
  function makeFish(index) {
    const group = new THREE.Group();
    const bodyMat = stdMat(index ? '#dca88a' : '#b9cac4', { roughness: 0.5, metalness: 0.15, flatShading: true });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), bodyMat);
    body.scale.set(0.75, 0.55, 2.0);
    group.add(body);
    const tailGeo = new THREE.BufferGeometry();
    tailGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, -0.33, 0.24, 0, -0.58, -0.24, 0, -0.58,
    ], 3));
    tailGeo.computeVertexNormals();
    group.add(new THREE.Mesh(tailGeo, bodyMat));
    const splashRing = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.23, 16), splashMatBase.clone());
    splashRing.rotation.x = -Math.PI / 2;
    splashRing.visible = false;
    root.add(splashRing);
    const angle = index ? 2.1 : 0.85;
    const radius = index ? 29.2 : 27.6;
    const fish = {
      group, splashRing, angle, radius,
      startX: Math.cos(angle) * radius,
      startZ: Math.sin(angle) * radius,
      period: index ? 23 : 17,
      offset: index ? 9 : 3.5,
      duration: 1.35 + index * 0.15,
      heading: index ? -1.2 : 2.4,
      phase: fishRng() * TAU,
    };
    group.visible = false;
    root.add(group);
    fishes.push(fish);
  }
  makeFish(0);
  makeFish(1);

  // ---- Fireflies ----------------------------------------------------------

  const fireflyCount = 72;
  const fireflyPositions = new Float32Array(fireflyCount * 3);
  const fireflySeeds = [];
  for (let i = 0; i < fireflyCount; i++) {
    let p = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      p = randomLandPoint(2.0, 0.84);
      if (p && !nearObject(p.x, p.z, 0.05)) break;
    }
    if (!p) p = { x: 0, z: 0, y: 1 };
    fireflySeeds.push({
      x: p.x, z: p.z, y: p.y + 1.1 + fishRng() * 2.6,
      phase: fishRng() * TAU,
      speed: 0.35 + fishRng() * 0.55,
      drift: 0.6 + fishRng() * 1.1,
    });
  }
  const fireflyGeo = new THREE.BufferGeometry();
  fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fireflyPositions, 3));
  const fireflyMat = new THREE.PointsMaterial({
    color: '#ffe7a0', size: 0.95, map: getGlowTexture(), transparent: true,
    opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    sizeAttenuation: true, alphaTest: 0.015,
  });
  const fireflies = new THREE.Points(fireflyGeo, fireflyMat);
  fireflies.frustumCulled = false;
  fireflies.renderOrder = 6;
  root.add(fireflies);

  // ---- Sea mist -----------------------------------------------------------

  const mistMaterial = new THREE.SpriteMaterial({
    map: getSoftTexture(), color: '#fff0de', transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.NormalBlending,
  });
  const mistSprites = [];
  const mistRng = mulberry32(717);
  for (let i = 0; i < 14; i++) {
    const sprite = new THREE.Sprite(mistMaterial);
    const angle = mistRng() * TAU;
    const radius = 21 + mistRng() * 11;
    const y = 0.5 + mistRng() * 1.1;
    sprite.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    const s = 7 + mistRng() * 8;
    sprite.scale.set(s * 1.7, s * 0.5, 1);
    sprite.renderOrder = 7;
    root.add(sprite);
    mistSprites.push({ sprite, angle, radius, y, phase: mistRng() * TAU });
  }

  // ---- Foam lines ---------------------------------------------------------

  const foamRng = mulberry32(1001);
  const foamBands = [];
  function makeFoamBand({ start, end, offset, width, opacity, phase }) {
    const segments = 96;
    const positions = new Float32Array((segments + 1) * 2 * 3);
    const indices = [];
    for (let i = 0; i < segments; i++) {
      const inner = i * 2;
      indices.push(inner, inner + 1, inner + 2, inner + 1, inner + 3, inner + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    const mat = new THREE.MeshBasicMaterial({
      color: '#fff2dc', transparent: true, opacity, depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    root.add(mesh);
    foamBands.push({ mesh, geo, start, end, offset, width, opacity, phase, segments });
  }
  makeFoamBand({ start: -Math.PI, end: Math.PI, offset: 1.9, width: 0.18, opacity: 0.13, phase: 0.2 });
  makeFoamBand({ start: -0.35, end: 1.5, offset: 0.78, width: 0.32, opacity: 0.46, phase: 1.4 });
  makeFoamBand({ start: -0.05, end: 1.22, offset: 1.2, width: 0.17, opacity: 0.24, phase: 2.2 });

  // ---- Life, weather and light -------------------------------------------

  const cloudDay = new THREE.Color('#f8f2e6');
  const cloudNight = new THREE.Color('#5b6b84');
  const cloudStorm = new THREE.Color('#7c878c');
  const cloudSnow = new THREE.Color('#e4e7e4');
  const cloudWorking = new THREE.Color();
  const mistDay = new THREE.Color('#fff0de');
  const mistNight = new THREE.Color('#aebfd4');
  const mistWorking = new THREE.Color();

  function updateBoat(boat, dt, time) {
    boat.cooldown = Math.max(0, boat.cooldown - dt);
    let targetYaw = boat.dockYaw;
    let targetMove = 0;

    if (boat.state === 'sailing') {
      boat.angle += boat.angularSpeed * dt;
      boat.currentPos.x = Math.cos(boat.angle) * boat.orbitRadius;
      boat.currentPos.z = Math.sin(boat.angle) * boat.orbitRadius;
      targetYaw = -boat.angle;
      targetMove = 1;
      const gap = Math.abs(wrapAngle(boat.angle - harborAngle));
      if (boat.cooldown <= 0 && gap < 0.055) {
        boat.state = 'arriving';
        boat.timer = 0;
        boat.startPos.copy(boat.currentPos);
        boat.targetPos.copy(boat.berth);
      }
    } else if (boat.state === 'arriving') {
      boat.timer = Math.min(1, boat.timer + dt / 3.4);
      const u = catmullEase(boat.timer);
      boat.currentPos.lerpVectors(boat.startPos, boat.targetPos, u);
      targetYaw = Math.atan2(boat.targetPos.x - boat.startPos.x, boat.targetPos.z - boat.startPos.z);
      targetMove = 1 - smoothstep(0.72, 1, boat.timer) * 0.55;
      if (boat.timer >= 1) {
        boat.state = 'docked';
        boat.timer = 0;
        boat.currentPos.copy(boat.berth);
      }
    } else if (boat.state === 'docked') {
      boat.timer += dt;
      boat.currentPos.copy(boat.berth);
      targetYaw = boat.dockYaw;
      if (boat.timer > 7.5) {
        boat.state = 'leaving';
        boat.timer = 0;
        boat.startPos.copy(boat.berth);
        boat.exitAngle = harborAngle + 0.24 + boat.index * 0.035;
        boat.targetPos.set(
          Math.cos(boat.exitAngle) * boat.orbitRadius,
          0,
          Math.sin(boat.exitAngle) * boat.orbitRadius,
        );
      }
    } else if (boat.state === 'leaving') {
      boat.timer = Math.min(1, boat.timer + dt / 3.2);
      const u = catmullEase(boat.timer);
      boat.currentPos.lerpVectors(boat.startPos, boat.targetPos, u);
      targetYaw = Math.atan2(boat.targetPos.x - boat.startPos.x, boat.targetPos.z - boat.startPos.z);
      targetMove = 1;
      if (boat.timer >= 1) {
        boat.state = 'sailing';
        boat.angle = boat.exitAngle;
        boat.currentPos.copy(boat.targetPos);
        boat.cooldown = 16;
      }
    }

    boat.yaw = dampAngle(boat.yaw, targetYaw, 2.2, dt);
    boat.moveAmount = damp(boat.moveAmount, targetMove, 2.5, dt);
    const bob = Math.sin(time * 1.45 + boat.phase) * 0.055
      + Math.sin(time * 2.2 + boat.phase * 1.4) * 0.02;
    boat.group.position.set(boat.currentPos.x, 0.48 + bob, boat.currentPos.z);
    boat.group.rotation.set(
      Math.sin(time * 0.9 + boat.phase) * 0.018,
      boat.yaw,
      Math.sin(time * 1.2 + boat.phase) * 0.025,
    );
    boat.wakeMat.opacity = boat.moveAmount * 0.32;
  }

  function departBoat(index) {
    const boat = boats[index];
    if (!boat || boat.state === 'sailing' || boat.state === 'arriving') return;
    boat.state = 'leaving';
    boat.timer = 0;
    boat.startPos.copy(boat.berth);
    boat.exitAngle = harborAngle + 0.24 + boat.index * 0.035;
    boat.targetPos.set(
      Math.cos(boat.exitAngle) * boat.orbitRadius,
      0,
      Math.sin(boat.exitAngle) * boat.orbitRadius,
    );
  }

  const foamBaseRadius = 17.0;

  function update(dt, sky, weather, dayTime = 0.175) {
    dt = clamp(dt || 0, 0, 0.1);
    timeOf.elapsed += dt;
    const time = timeOf.elapsed;
    if (!sky || !weather) return;

    const night = sky.night ?? 0;
    const rain = weather.rain ?? 0;
    const snow = weather.snow ?? 0;
    const snowAmount = weather.snowAmount ?? 0;
    const storm = weather.storm ?? Math.max(rain, snow);
    const wind = Math.max(sky.wind ?? 0.4, weather.wind ?? 0.4);
    const dusk = smoothstep(0.43, 0.585, dayTime) * (1 - smoothstep(0.9, 0.995, dayTime));
    const lightLevel = clamp(Math.max(dusk, storm * 0.18, snow * 0.08), 0, 1);

    // Windows and street lamps wake up in a slow, uneven wave at dusk.
    for (const house of houses) {
      const on = smoothstep(house.threshold, house.threshold + 0.075, lightLevel);
      house.windowMat.emissiveIntensity = on * 2.35;
      house.snowRoof.visible = snowAmount > 0.008;
    }
    snowRoofMaterial.opacity = clamp(snowAmount * 1.1, 0, 0.99);

    for (const lamp of lamps) {
      const on = smoothstep(lamp.threshold, lamp.threshold + 0.065, lightLevel);
      lamp.glassMat.emissiveIntensity = on * 2.5;
      lamp.glow.material.opacity = on * 0.54;
    }
    for (const entry of pointLights) {
      const on = smoothstep(entry.threshold, entry.threshold + 0.08, lightLevel);
      entry.light.intensity = on * 16;
    }

    for (const boat of boats) {
      boat.lanternMat.emissiveIntensity = lightLevel * 2.4;
      boat.glassMat.emissiveIntensity = lightLevel * 1.7;
      boat.glow.material.opacity = lightLevel * 0.56;
      updateBoat(boat, dt, time);
    }

    // The lighthouse keeps its patient circuit, brightest after dark.
    beamGroup.rotation.y = time * 0.5;
    beamMat.uniforms.uOpacity.value = night * 0.16;
    beamCore.material.uniforms.uOpacity.value = night * 0.22;
    // Let the ceramic base keep a faint warm presence after dark rather than
    // disappearing into a black slab.
    baseMat.emissive.setRGB(0.10, 0.075, 0.052);
    baseMat.emissiveIntensity = night * 0.7;
    baseSideMat.emissive.copy(baseMat.emissive);
    baseSideMat.emissiveIntensity = night * 0.55;
    plaqueMat.emissiveIntensity = 0.05 + night * 0.55;
    lhGlow.material.opacity = night * 0.82;
    lighthouseLight.intensity = night * 72;
    lanternMat.emissiveIntensity = 0.2 + night * 3.1;
    lhWinMat.emissiveIntensity = smoothstep(0.24, 0.42, lightLevel) * 2.0;

    // Windmill and its floury little windows.
    millWindowMat.emissiveIntensity = lightLevel * 2.0;
    bladeWheel.rotation.z -= dt * (0.33 + Math.max(0, weather.wind) * 0.22);

    for (const cloth of laundry) {
      cloth.mesh.rotation.z = cloth.baseZ
        + Math.sin(time * 1.65 + cloth.phase) * 0.16 * (0.45 + wind);
      cloth.mesh.rotation.x = Math.sin(time * 1.07 + cloth.phase * 1.3) * 0.08;
    }
    flag.rotation.y = Math.sin(time * 0.8) * 0.035;
    flagCloth.rotation.y = Math.sin(time * 2.1) * 0.18 + Math.sin(time * 3.7) * 0.05;

    updateTreeInstances(time, wind);
    updateGrass(time, wind);

    cloudWorking.copy(cloudDay).lerp(cloudNight, night * 0.82);
    cloudWorking.lerp(cloudStorm, storm * 0.55);
    cloudWorking.lerp(cloudSnow, snow * 0.35);
    cloudMaterial.color.copy(cloudWorking);
    for (const cloud of clouds) {
      cloud.angle += cloud.speed * dt * (1 + storm * 0.75);
      cloud.mesh.position.set(
        Math.cos(cloud.angle) * cloud.radius,
        cloud.y + Math.sin(time * 0.3 + cloud.angle * 2) * 0.4,
        Math.sin(cloud.angle) * cloud.radius,
      );
      cloud.mesh.scale.setScalar(cloud.baseScale * (1 + storm * 0.15));
      cloud.mesh.rotation.y += dt * 0.008;
    }

    const smokeFade = 1 - rain * 0.25;
    for (let i = 0; i < smokePuffs.length; i++) {
      const puff = smokePuffs[i];
      const age = (time * puff.speed + puff.phase) % 1;
      const fade = Math.pow(Math.sin(Math.PI * age), 1.25);
      const sway = Math.sin(time * 0.7 + puff.wobble + age * 5) * 0.22 * age;
      const j = i * 3;
      smokePositions[j] = puff.origin.x + puff.drift * age + sway + wind * 0.42 * age;
      smokePositions[j + 1] = puff.origin.y + age * 3.25;
      smokePositions[j + 2] = puff.origin.z + Math.sin(time * 0.5 + puff.wobble * 2 + age * 3) * 0.18 * age;
      smokeAlpha[i] = fade * 0.42 * smokeFade;
      smokeSizes[i] = (0.5 + age * 2.05) * puff.size;
    }
    smokeGeo.attributes.position.needsUpdate = true;
    smokeGeo.attributes.aAlpha.needsUpdate = true;
    smokeGeo.attributes.aSize.needsUpdate = true;

    const gullVisible = rain < 0.42 && snow < 0.38 && night < 0.8;
    for (const gull of gulls) {
      gull.angle += gull.speed * dt * (1 + storm * 0.6);
      gull.group.position.set(
        Math.cos(gull.angle) * gull.radius,
        gull.height + Math.sin(time * 0.45 + gull.phase) * 1.15,
        Math.sin(gull.angle) * gull.radius,
      );
      gull.group.rotation.y = -gull.angle;
      gull.group.rotation.z = Math.sin(time * 0.38 + gull.phase) * 0.16;
      gull.group.rotation.x = Math.sin(time * 0.33 + gull.phase * 1.7) * 0.06;
      const flap = Math.sin(time * gull.flap + gull.phase) * 0.6;
      gull.wingR.rotation.z = flap + 0.08;
      gull.wingL.rotation.z = -flap - 0.08;
      gull.group.visible = gullVisible;
    }

    for (const fish of fishes) {
      const cycle = (time + fish.offset) % fish.period;
      const active = cycle < fish.duration;
      fish.group.visible = active;
      fish.splashRing.visible = false;
      if (!active) continue;
      const p = cycle / fish.duration;
      const distance = 3.4;
      const x = fish.startX + Math.cos(fish.heading) * distance * p;
      const z = fish.startZ + Math.sin(fish.heading) * distance * p;
      const y = 0.16 + Math.sin(Math.PI * p) * 2.15;
      fish.group.position.set(x, y, z);
      fish.group.rotation.set(-Math.cos(Math.PI * p) * 0.85, fish.heading, 0);
      if (p < 0.18 || p > 0.82) {
        const u = p < 0.18 ? p / 0.18 : (1 - p) / 0.18;
        fish.splashRing.visible = true;
        fish.splashRing.position.set(x, 0.12, z);
        fish.splashRing.scale.setScalar(0.7 + (1 - u) * 2.8);
        fish.splashRing.material.opacity = (1 - u) * 0.55;
      }
    }

    const fireflyAmount = night * (1 - Math.max(rain * 0.7, snow * 0.68));
    fireflies.visible = fireflyAmount > 0.025;
    fireflyMat.opacity = fireflyAmount * (0.86 + 0.16 * Math.sin(time * 1.7));
    for (let i = 0; i < fireflySeeds.length; i++) {
      const seed = fireflySeeds[i];
      const j = i * 3;
      fireflyPositions[j] = seed.x
        + Math.sin(time * seed.speed + seed.phase) * seed.drift
        + Math.sin(time * 0.37 + seed.phase * 2.1) * 0.3;
      fireflyPositions[j + 1] = seed.y + Math.sin(time * 0.7 + seed.phase * 1.6) * 0.38;
      fireflyPositions[j + 2] = seed.z
        + Math.cos(time * seed.speed * 0.82 + seed.phase) * seed.drift * 0.8;
    }
    fireflyGeo.attributes.position.needsUpdate = true;

    mistWorking.copy(mistDay).lerp(mistNight, night);
    mistMaterial.color.copy(mistWorking);
    mistMaterial.opacity = clamp(sky.mist * 0.14 + rain * 0.025, 0, 0.17);
    for (const mist of mistSprites) {
      mist.angle += dt * 0.004;
      mist.sprite.position.set(
        Math.cos(mist.angle) * (mist.radius + Math.sin(time * 0.07 + mist.phase) * 1.3),
        mist.y + Math.sin(time * 0.11 + mist.phase) * 0.3,
        Math.sin(mist.angle) * (mist.radius + Math.sin(time * 0.07 + mist.phase) * 1.3),
      );
    }

    for (const band of foamBands) {
      const positions = band.geo.attributes.position.array;
      for (let i = 0; i <= band.segments; i++) {
        const a = band.start + (band.end - band.start) * (i / band.segments);
        const wobble = Math.sin(a * 7 + time * 0.8 + band.phase) * 0.2
          + Math.sin(a * 13 - time * 0.55 + band.phase * 2) * 0.1;
        const radius = foamBaseRadius + band.offset + wobble;
        const inner = radius - band.width * 0.5;
        const outer = radius + band.width * 0.5;
        const y = 0.105 + Math.sin(a * 9 + time * 1.4 + band.phase) * 0.02;
        const j = i * 6;
        positions[j] = Math.cos(a) * inner;
        positions[j + 1] = y;
        positions[j + 2] = Math.sin(a) * inner;
        positions[j + 3] = Math.cos(a) * outer;
        positions[j + 4] = y;
        positions[j + 5] = Math.sin(a) * outer;
      }
      band.geo.attributes.position.needsUpdate = true;
      band.mesh.material.opacity = band.opacity * (0.8 + 0.2 * Math.sin(time * 0.9 + band.phase))
        * (1 - night * 0.28);
    }

    // Rain makes the footpaths dark and mirror-slick, and fills the low puddles.
    pathMaterial.color.copy(pathDry).lerp(pathWet, rain * 0.68);
    pathMaterial.roughness = 0.93 - rain * 0.63;
    pathMaterial.metalness = rain * 0.14;
    puddleMaterial.opacity = rain * 0.42;
    for (const puddle of puddles) puddle.visible = rain > 0.015;
  }

  // Tiny trim pieces barely register in a shadow, but each one costs a draw
  // call in the shadow pass. Keep shadows for the readable silhouettes.
  root.traverse((object) => {
    if (!object.isMesh || object.isInstancedMesh || !object.castShadow) return;
    if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
    const radius = object.geometry.boundingSphere?.radius || 0;
    const scale = Math.max(object.scale.x, object.scale.y, object.scale.z);
    if (radius * scale < 0.34) object.castShadow = false;
  });

  return {
    root, terrain, cliffs, clickables, houses, boats, lamps, pointLights,
    lighthouse, windmill, pierGroup, gulls, fishes, fireflies, foamBands, smoke,
    timeOf, terrainHeightAt, boundaryRadius, pathMaterial, puddleMaterial,
    departBoat, update,
  };
}
