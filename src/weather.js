import * as THREE from 'three';
import { clamp, damp, getSoftTexture, mulberry32, TAU } from './util.js';

const RAIN_COUNT = 1700;
const SNOW_COUNT = 1500;
const RIPPLE_COUNT = 26;

export function createWeather(scene) {
  const rng = mulberry32(7331);
  const state = {
    mode: 'clear',
    targetRain: 0,
    targetSnow: 0,
    rain: 0,
    snow: 0,
    storm: 0,
    snowAmount: 0,
    wind: 0.4,
    flash: 0,
  };

  const rainGeometry = new THREE.BufferGeometry();
  const rainPositions = new Float32Array(RAIN_COUNT * 6);
  const rainSeeds = [];
  for (let i = 0; i < RAIN_COUNT; i++) {
    const angle = rng() * TAU;
    const radius = Math.sqrt(rng()) * 38;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = rng() * 26;
    const speed = 12 + rng() * 9;
    const phase = rng() * TAU;
    rainSeeds.push({ x, z, y, speed, phase });
  }
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rainMaterial = new THREE.LineBasicMaterial({
    color: 0xc6dbe0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);

  const snowGeometry = new THREE.BufferGeometry();
  const snowPositions = new Float32Array(SNOW_COUNT * 3);
  const snowSeeds = [];
  for (let i = 0; i < SNOW_COUNT; i++) {
    const angle = rng() * TAU;
    const radius = Math.sqrt(rng()) * 37;
    snowSeeds.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      y: rng() * 25,
      speed: 1.2 + rng() * 2.2,
      phase: rng() * TAU,
      sway: 0.5 + rng() * 1.7,
    });
  }
  snowGeometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
  const snowMaterial = new THREE.PointsMaterial({
    color: 0xfffbef,
    size: 0.62,
    map: getSoftTexture(),
    transparent: true,
    opacity: 0,
    alphaTest: 0.015,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const snow = new THREE.Points(snowGeometry, snowMaterial);
  snow.frustumCulled = false;
  snow.visible = false;
  scene.add(snow);

  const rippleGeometry = new THREE.RingGeometry(0.18, 0.27, 22);
  rippleGeometry.rotateX(-Math.PI / 2);
  const ripples = [];
  const ringGroup = new THREE.Group();
  ringGroup.name = 'rain ripples';
  for (let i = 0; i < RIPPLE_COUNT; i++) {
    const angle = rng() * TAU;
    const radius = 19 + rng() * 12.5;
    const material = new THREE.MeshBasicMaterial({
      color: 0xfff6e8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(rippleGeometry, material);
    ring.position.set(Math.cos(angle) * radius, 0.14, Math.sin(angle) * radius);
    ring.renderOrder = 2;
    ring.visible = false;
    ringGroup.add(ring);
    ripples.push({
      mesh: ring,
      material,
      phase: rng(),
      offset: rng() * TAU,
    });
  }
  scene.add(ringGroup);

  let elapsed = 0;
  let flashTimer = 0;

  function setMode(mode) {
    if (!['clear', 'rain', 'snow'].includes(mode)) return;
    state.mode = mode;
    state.targetRain = mode === 'rain' ? 1 : 0;
    state.targetSnow = mode === 'snow' ? 1 : 0;
  }

  function update(dt, absoluteTime) {
    elapsed += dt;
    const time = absoluteTime ?? elapsed;
    state.rain = damp(state.rain, state.targetRain, 1.7, dt);
    state.snow = damp(state.snow, state.targetSnow, 1.05, dt);
    if (state.rain < 0.002 && state.targetRain === 0) state.rain = 0;
    if (state.snow < 0.002 && state.targetSnow === 0) state.snow = 0;
    state.storm = Math.max(state.rain, state.snow * 0.72);
    state.wind = 0.38 + state.rain * 1.0 + state.snow * 0.64 + state.storm * 0.32;

    if (state.targetSnow > 0.5 && state.snow > 0.15) {
      state.snowAmount = clamp(state.snowAmount + dt / 24, 0, 1);
    } else {
      state.snowAmount = clamp(state.snowAmount - dt / 16, 0, 1);
    }

    if (state.rain > 0.01) {
      rain.visible = true;
      rainMaterial.opacity = 0.4 * state.rain;
      for (let i = 0; i < RAIN_COUNT; i++) {
        const seed = rainSeeds[i];
        const fall = (seed.y + time * seed.speed) % 26;
        const y = 25.2 - fall;
        const windSlant = state.wind * 0.6 + Math.sin(time * 0.38 + seed.phase) * 0.08;
        const x = seed.x + Math.sin(time * 0.22 + seed.phase) * 0.5;
        const z = seed.z + Math.cos(time * 0.17 + seed.phase) * 0.35;
        const j = i * 6;
        rainPositions[j] = x;
        rainPositions[j + 1] = y;
        rainPositions[j + 2] = z;
        rainPositions[j + 3] = x + windSlant * 0.22;
        rainPositions[j + 4] = y + 0.55 + state.rain * 0.45;
        rainPositions[j + 5] = z + 0.06;
      }
      rainGeometry.attributes.position.needsUpdate = true;
    } else {
      rain.visible = false;
    }

    if (state.snow > 0.01) {
      snow.visible = true;
      snowMaterial.opacity = state.snow;
      for (let i = 0; i < SNOW_COUNT; i++) {
        const seed = snowSeeds[i];
        const fall = (seed.y + time * seed.speed) % 25;
        snowPositions[i * 3] = seed.x + Math.sin(time * 0.34 + seed.phase) * seed.sway;
        snowPositions[i * 3 + 1] = 24.8 - fall;
        snowPositions[i * 3 + 2] = seed.z + Math.cos(time * 0.25 + seed.phase) * seed.sway * 0.7;
      }
      snowGeometry.attributes.position.needsUpdate = true;
    } else {
      snow.visible = false;
    }

    const rippleVisible = state.rain > 0.03;
    ringGroup.visible = rippleVisible;
    for (let i = 0; i < RIPPLE_COUNT; i++) {
      const ripple = ripples[i];
      const cycle = (time * 0.48 + ripple.phase) % 1;
      const scale = 0.4 + cycle * 3.5;
      ripple.mesh.scale.setScalar(scale);
      ripple.material.opacity = Math.sin(cycle * Math.PI) * 0.24 * state.rain;
      ripple.mesh.visible = rippleVisible;
    }

    // A rare, low, warm flash of lightning in heavy rain. Kept gentle for coziness.
    flashTimer -= dt;
    state.flash = damp(state.flash, 0, 6.5, dt);
    if (state.rain > 0.65 && flashTimer <= 0) {
      flashTimer = 22 + (Math.sin(time * 0.73) * 0.5 + 0.5) * 30;
      if (Math.sin(time * 1.77 + 2.1) > 0.55) state.flash = 0.55;
    }

    return state;
  }

  return { state, update, setMode, rain, snow, ripples };
}
