import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createSky } from './sky.js';
import { createWater } from './water.js';
import { createWeather } from './weather.js';
import { createWorld } from './world.js';
import { createAudio } from './audio.js';
import { createFilm } from './film.js';
import { clamp, smootherstep } from './util.js';

const params = new URLSearchParams(window.location.search);
const recordMode = params.get('record') === '1';
const canvas = document.getElementById('harbor');
if (recordMode) document.body.classList.add('record');

const WIDTH = recordMode ? 1080 : window.innerWidth;
const HEIGHT = recordMode ? 1350 : window.innerHeight;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(recordMode ? 1 : Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(WIDTH, HEIGHT, !recordMode);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#223a43');

const camera = new THREE.PerspectiveCamera(38, WIDTH / HEIGHT, 0.1, 900);
// A low, three-quarter view keeps the ceramic plinth, the pier and the sky
// all in the same frame, the way a diorama sits on a table.
const homeDir = new THREE.Vector3(0.54, 0.17, 0.68).normalize();
const homeTarget = new THREE.Vector3(1.8, 1.9, 1.8);
const homePos = new THREE.Vector3();

function frameHome() {
  const aspect = camera.aspect;
  if (!recordMode) {
    // Narrow screens need a wider lens, or the little island would be cropped.
    // The extra width also keeps the camera close enough that distance fog
    // does not wash the pastel village out on a phone.
    camera.fov = clamp(38 + Math.max(0, 1 - aspect) * 50, 38, 64);
    camera.updateProjectionMatrix();
  }
  const vertical = THREE.MathUtils.degToRad(camera.fov);
  const framedWidth = aspect < 1 ? 82 : 88;
  const distance = clamp(framedWidth / (2 * Math.tan(vertical / 2) * aspect) * 1.02, 70, aspect < 1 ? 200 : 240);
  homePos.copy(homeDir).multiplyScalar(distance);
  homePos.y = Math.max(homePos.y, homeTarget.y + 12);
}
frameHome();
camera.position.copy(homePos);
camera.lookAt(homeTarget);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(homeTarget);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.enablePan = false;
controls.minDistance = 13;
controls.maxDistance = 260;
controls.minPolarAngle = 0.12;
controls.maxPolarAngle = Math.PI / 2 - 0.06;
controls.rotateSpeed = 0.62;
controls.zoomSpeed = 0.82;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.24;
if (recordMode) controls.enabled = false;

const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(WIDTH, HEIGHT);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(new THREE.Vector2(WIDTH, HEIGHT), 0.16, 0.55, 0.89);
composer.addPass(bloom);

const bokeh = new BokehPass(scene, camera, {
  focus: camera.position.distanceTo(homeTarget),
  aperture: 0.0005,
  maxblur: 0.0034,
});
composer.addPass(bokeh);

composer.addPass(new OutputPass());

const sky = createSky(scene, renderer);
const water = createWater();
scene.add(water.mesh);
const world = createWorld(scene);
const weather = createWeather(scene);
const audio = createAudio();

const film = recordMode ? createFilm({ camera, world, weather }) : null;
const lookTarget = homeTarget.clone();

let dayTime = 0.175;
let speed = 1;
let pausedDays = false;
let simTime = 0;
let fps = 0;
let fpsFrames = 0;
let fpsElapsed = 0;
let filmFrame = 0;
let filmFinished = false;
// `?record=1&paused=1` holds the film on frame zero so stills can be stepped
// deterministically from the very beginning of the timeline.
let recordPaused = recordMode && params.get('paused') === '1';

const clock = new THREE.Clock();

// ---- UI -----------------------------------------------------------------

const ui = {
  clock: document.getElementById('clock'),
  phase: document.getElementById('phase'),
  phaseIcon: document.getElementById('phase-icon'),
  timeCopy: document.getElementById('time-copy'),
  timePhase: document.getElementById('time-phase'),
  slider: document.getElementById('day-slider'),
  hint: document.getElementById('hint'),
  sound: document.getElementById('sound-btn'),
  focusCard: document.getElementById('focus-card'),
  focusKicker: document.getElementById('focus-kicker'),
  focusName: document.getElementById('focus-name'),
  focusNote: document.getElementById('focus-note'),
  focusReturn: document.getElementById('focus-return'),
  loader: document.getElementById('loader'),
};
if (ui.slider) ui.slider.value = String(dayTime);
let scrubbing = false;

function phaseInfo(t) {
  if (t < 0.035) return { label: 'dawn', badge: 'Dawn mist', night: true };
  if (t < 0.085) return { label: 'first light', badge: 'First light', night: true };
  if (t < 0.2) return { label: 'morning', badge: 'Morning light' };
  if (t < 0.32) return { label: 'midday', badge: 'High sun' };
  if (t < 0.41) return { label: 'afternoon', badge: 'Afternoon' };
  if (t < 0.47) return { label: 'golden hour', badge: 'Golden hour' };
  if (t < 0.53) return { label: 'sunset', badge: 'Sunset' };
  if (t < 0.6) return { label: 'dusk', badge: 'Lights coming on', night: true };
  if (t < 0.82) return { label: 'night', badge: 'Quiet night', night: true };
  if (t < 0.92) return { label: 'late night', badge: 'Late night', night: true };
  return { label: 'before dawn', badge: 'Before dawn', night: true };
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function updateClockUI() {
  const hours = (dayTime * 24 + 6) % 24;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  const copy = `${pad(h)}:${pad(m)}`;
  if (ui.clock) ui.clock.textContent = copy;
  if (ui.timeCopy) ui.timeCopy.textContent = copy;
  const info = phaseInfo(dayTime);
  if (ui.phase) ui.phase.textContent = info.badge;
  if (ui.timePhase) ui.timePhase.textContent = info.label;
  if (ui.phaseIcon) ui.phaseIcon.classList.toggle('night', !!info.night);
}

if (ui.slider) {
  ui.slider.addEventListener('pointerdown', () => { scrubbing = true; });
  window.addEventListener('pointerup', () => { scrubbing = false; });
  ui.slider.addEventListener('input', () => {
    dayTime = ((parseFloat(ui.slider.value) % 1) + 1) % 1;
    updateClockUI();
  });
}

for (const button of document.querySelectorAll('.speed-btn')) {
  button.addEventListener('click', () => {
    speed = parseFloat(button.dataset.speed) || 1;
    for (const other of document.querySelectorAll('.speed-btn')) {
      other.classList.toggle('active', other === button);
      other.setAttribute('aria-pressed', String(other === button));
    }
  });
}

for (const button of document.querySelectorAll('.weather-btn')) {
  button.addEventListener('click', () => {
    const mode = button.dataset.weather;
    weather.setMode(mode);
    for (const other of document.querySelectorAll('.weather-btn')) {
      other.classList.toggle('active', other === button);
      other.setAttribute('aria-pressed', String(other === button));
    }
    if (ui.hint) ui.hint.classList.add('faded');
  });
}

if (ui.sound) {
  ui.sound.addEventListener('click', () => {
    const on = audio.toggle();
    ui.sound.classList.toggle('active', on);
    ui.sound.setAttribute('aria-pressed', String(on));
    ui.sound.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
    ui.sound.title = on ? 'Sound on' : 'Sound off';
  });
}

if (ui.focusReturn) ui.focusReturn.addEventListener('click', returnHome);
setTimeout(() => { if (ui.hint) ui.hint.classList.add('faded'); }, 10000);
updateClockUI();

// ---- Camera visits ------------------------------------------------------

let focused = null;
let flight = null;
let idle = 0;
let lastInteraction = 0;

function targetPoint(object, data) {
  const point = new THREE.Vector3();
  object.getWorldPosition(point);
  point.y += data.targetHeight || 0;
  return point;
}

function focusView(object, data, horizontalDir) {
  const target = targetPoint(object, data);
  const dist = data.focusDistance || 8;
  const height = data.focusHeight || 4;
  const horizontal = Math.sqrt(Math.max(1.5, dist * dist - height * height));
  const dir = horizontalDir ? horizontalDir.clone() : new THREE.Vector3(1, 0, 1);
  const position = target.clone().addScaledVector(dir, horizontal);
  position.y = target.y + height;
  return { target, position, dir, horizontal, height };
}

function visit(object, data) {
  const target = targetPoint(object, data);
  const flat = camera.position.clone().sub(target);
  flat.y = 0;
  if (flat.lengthSq() < 0.001) flat.set(1, 0, 1);
  flat.normalize();
  const view = focusView(object, data, flat);
  flight = {
    elapsed: 0,
    duration: 1.35,
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: view.position,
    toTarget: view.target,
    object,
    data,
    follow: data.follow === true,
    view,
  };
  focused = { object, data, follow: data.follow === true, lastTarget: view.target.clone() };
  controls.autoRotate = false;
  controls.enabled = false;
  idle = 0;
  lastInteraction = performance.now();
  if (ui.focusKicker) {
    ui.focusKicker.textContent = {
      house: 'a little household',
      boat: 'out on the water',
      windmill: 'the mill on the hill',
      lighthouse: 'the light at the point',
    }[data.type] || 'a little place';
  }
  if (ui.focusName) ui.focusName.textContent = data.name || 'Tiny Harbor';
  if (ui.focusNote) ui.focusNote.textContent = data.note || 'Wander as long as you like.';
  if (ui.focusCard) ui.focusCard.classList.add('visible');
  if (ui.hint) ui.hint.classList.add('faded');
}

function returnHome() {
  focused = null;
  if (ui.focusCard) ui.focusCard.classList.remove('visible');
  controls.autoRotate = false;
  controls.enabled = false;
  flight = {
    elapsed: 0,
    duration: 1.5,
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: homePos.clone(),
    toTarget: homeTarget.clone(),
    object: null,
    data: null,
    follow: false,
    view: null,
  };
  idle = 0;
  lastInteraction = performance.now();
}

function updateFlight(dt) {
  if (!flight) return;
  if (flight.follow && flight.object && flight.data) {
    const view = focusView(flight.object, flight.data, flight.view.dir);
    flight.toPos.copy(view.position);
    flight.toTarget.copy(view.target);
  }
  flight.elapsed = Math.min(flight.duration, flight.elapsed + dt);
  const u = smootherstep(0, 1, flight.elapsed / flight.duration);
  camera.position.lerpVectors(flight.fromPos, flight.toPos, u);
  controls.target.lerpVectors(flight.fromTarget, flight.toTarget, u);
  camera.lookAt(controls.target);
  if (u >= 1) {
    if (focused && focused.follow) {
      focused.lastTarget.copy(targetPoint(flight.object, flight.data));
    }
    flight = null;
    controls.enabled = true;
  }
}

function followFocused() {
  if (!focused || !focused.follow || flight) return;
  const current = targetPoint(focused.object, focused.data);
  const delta = current.clone().sub(focused.lastTarget);
  if (delta.lengthSq() > 0.0000001) {
    camera.position.add(delta);
    controls.target.add(delta);
    focused.lastTarget.copy(current);
  }
}

// ---- Picking ------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let press = null;

function pick(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(world.clickables, true);
  for (const hit of hits) {
    let object = hit.object;
    while (object && !object.userData.clickable) object = object.parent;
    if (object) return { object, data: object.userData.clickable };
  }
  return null;
}

function overWater(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(water.mesh, false).length > 0;
}

if (!recordMode) {
  canvas.addEventListener('pointerdown', (event) => {
    press = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
      pointerId: event.pointerId,
    };
    idle = 0;
    lastInteraction = performance.now();
    controls.autoRotate = false;
    if (ui.hint) ui.hint.classList.add('faded');
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!press || press.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    const held = performance.now() - press.time;
    press = null;
    if (moved > 8 || held > 650) return;
    const hit = pick(event.clientX, event.clientY);
    if (hit) {
      visit(hit.object, hit.data);
    } else if (focused && overWater(event.clientX, event.clientY)) {
      returnHome();
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || press) return;
    canvas.classList.toggle('pointing', !!pick(event.clientX, event.clientY));
  });

  canvas.addEventListener('pointerleave', () => {
    canvas.classList.remove('pointing');
  });

  controls.addEventListener('start', () => {
    idle = 0;
    lastInteraction = performance.now();
    controls.autoRotate = false;
    if (ui.hint) ui.hint.classList.add('faded');
  });
}

// ---- Simulation and rendering ------------------------------------------

function stepSimulation(dt, absoluteTime, timeOfDay) {
  weather.update(dt, absoluteTime);
  sky.update(timeOfDay, weather.state);
  world.update(dt, sky.state, weather.state, timeOfDay);
  water.update({ time: absoluteTime, sky: sky.state, weather: weather.state });
  audio.update({ dt, time: absoluteTime, weather: weather.state });
}

function updatePost() {
  if (bokeh.uniforms && bokeh.uniforms.focus) {
    bokeh.uniforms.focus.value = camera.position.distanceTo(lookTarget);
  }
  bloom.strength = 0.15 + sky.state.night * 0.27 + sky.state.storm * 0.04;
}

let loaderHidden = false;
function hideLoader() {
  if (loaderHidden) return;
  loaderHidden = true;
  if (ui.loader) {
    ui.loader.classList.add('gone');
    setTimeout(() => ui.loader?.remove(), 1300);
  }
}

function measureFps(dt) {
  if (recordMode) return;
  fpsFrames++;
  fpsElapsed += dt;
  if (fpsElapsed >= 0.6) {
    fps = fpsFrames / fpsElapsed;
    fpsFrames = 0;
    fpsElapsed = 0;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  measureFps(rawDt);
  simTime += dt;

  if (!pausedDays) {
    dayTime = (dayTime + (dt * speed) / 60) % 1;
  }

  updateFlight(dt);
  if (focused) followFocused();
  if (!flight) {
    // Idle time is a real-world courtesy, not simulation time: on a slow
    // device the view should still start drifting after ten actual seconds.
    idle += Math.min(rawDt, 0.5);
    controls.autoRotate = !focused && idle > 10;
    controls.update();
  }

  stepSimulation(dt, simTime, dayTime);

  if (ui.slider && !scrubbing) ui.slider.value = String(dayTime);
  updateClockUI();
  lookTarget.copy(controls.target);
  updatePost();
  composer.render();
  hideLoader();
}

function animateRecord() {
  if (recordPaused) {
    requestAnimationFrame(animateRecord);
    return;
  }
  const dt = 1 / 60;
  const time = filmFrame / 60;
  const shot = film.update(time);
  dayTime = shot.dayTime;
  camera.userData.filmTarget = shot.target;
  simTime = time;
  stepSimulation(dt, time, dayTime);
  lookTarget.copy(shot.target);
  updatePost();
  composer.render();
  filmFrame++;
  if (filmFrame <= 40 * 60) {
    requestAnimationFrame(animateRecord);
  } else {
    filmFinished = true;
  }
}

// ---- Responsive ---------------------------------------------------------

function resize() {
  if (recordMode) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  frameHome();
  if (!focused && !flight && camera.position.distanceTo(homePos) < 75) {
    camera.position.copy(homePos);
    controls.target.copy(homeTarget);
  }
  controls.maxDistance = Math.max(260, homePos.length() * 1.8);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

// ---- Test and capture hooks --------------------------------------------

window.__tinyHarbor = {
  renderer,
  scene,
  camera,
  composer,
  world,
  sky,
  weather,
  audio,
  controls,
  get dayTime() { return dayTime; },
  get fps() { return fps; },
  get filmFrame() { return filmFrame; },
  get filmTime() { return filmFrame / 60; },
  get filmFinished() { return filmFinished; },
  setDayTime(value) {
    dayTime = ((value % 1) + 1) % 1;
    pausedDays = true;
    if (ui.slider) ui.slider.value = String(dayTime);
    updateClockUI();
  },
  setSpeed(value) {
    speed = clamp(value, 0.1, 12);
    pausedDays = false;
  },
  pauseTime(value = true) {
    pausedDays = !!value;
  },
  setWeather(mode) {
    weather.setMode(mode);
  },
  pickAt(x, y) {
    const hit = pick(x, y);
    return hit ? { type: hit.data.type, name: hit.data.name } : null;
  },
  screenPointFor(type) {
    const object = world.clickables.find((entry) => entry.userData.clickable?.type === type);
    if (!object) return null;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3()).project(camera);
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (center.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-center.y * 0.5 + 0.5) * rect.height,
    };
  },
  get flying() { return !!flight; },
  get focusedType() { return focused?.data?.type || null; },
  overWaterAt(x, y) {
    return overWater(x, y);
  },
  renderOnce() {
    stepSimulation(1 / 60, simTime, dayTime);
    updatePost();
    composer.render();
  },
  advance(seconds = 1) {
    const steps = Math.max(1, Math.round(clamp(seconds, 0, 30) * 60));
    for (let i = 0; i < steps; i++) {
      simTime += 1 / 60;
      stepSimulation(1 / 60, simTime, dayTime);
    }
  },
  pauseFilm(value = true) {
    recordPaused = !!value;
  },
  filmStill(seconds) {
    if (!film) return;
    recordPaused = true;
    const targetFrame = Math.round(clamp(seconds, 0, 40) * 60);
    // Step the whole film forward rather than dropping one cold frame, so
    // weather, boats and particle systems match what a viewer would see.
    // Stills should be requested in ascending order.
    let shot = null;
    while (filmFrame < targetFrame) {
      filmFrame++;
      shot = film.update(filmFrame / 60);
      dayTime = shot.dayTime;
      simTime = filmFrame / 60;
      stepSimulation(1 / 60, simTime, dayTime);
    }
    if (!shot) {
      shot = film.update(filmFrame / 60);
      dayTime = shot.dayTime;
      simTime = filmFrame / 60;
      stepSimulation(1 / 60, simTime, dayTime);
    }
    lookTarget.copy(shot.target);
    updatePost();
    composer.render();
  },
};

// ---- Go ----------------------------------------------------------------

if (recordMode) {
  hideLoader();
  requestAnimationFrame(animateRecord);
} else {
  requestAnimationFrame(animate);
}
