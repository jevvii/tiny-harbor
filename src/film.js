import * as THREE from 'three';
import { smootherstep } from './util.js';

// A fixed, 40-second miniature film. The camera, light and weather are all
// keyed by film time, so the same frame number always produces the same shot.

const CAMERA_KEYS = [
  { t: 0.0, p: [74, 25, 100], q: [0, 1.5, 0] },
  { t: 4.6, p: [66, 23, 90], q: [0, 1.5, 0] },
  { t: 6.4, p: [30, 18, 42], q: [10.4, 1.2, 9.2] },
  { t: 10.6, p: [22, 14, 33], q: [13.0, 0.9, 11.5] },
  { t: 12.6, p: [0.5, 11.6, 14.8], q: [-4.8, 6.2, -2.2] },
  { t: 16.4, p: [-1.8, 10.4, 13.4], q: [-4.8, 6.6, -2.2] },
  { t: 18.6, p: [-27, 17, 31], q: [-3.4, 2.2, 5.4] },
  { t: 23.0, p: [-26, 16, 29], q: [-3.0, 2.1, 5.2] },
  { t: 26.2, p: [-1.5, 13.0, 13.0], q: [-12.2, 7.8, -8.2] },
  { t: 30.8, p: [-22, 16, 26], q: [-3.0, 2.4, 5.0] },
  { t: 33.6, p: [8.5, 12.0, 24.0], q: [9.0, 1.4, 9.0] },
  { t: 36.4, p: [40, 20, 55], q: [2.0, 1.5, 4.0] },
  { t: 40.0, p: [74, 25, 100], q: [0, 1.5, 0] },
];

const DAY_KEYS = [
  { t: 0.0, v: 0.004 },
  { t: 3.4, v: 0.024 },
  { t: 6.2, v: 0.095 },
  { t: 10.2, v: 0.215 },
  { t: 12.6, v: 0.25 },
  { t: 16.4, v: 0.395 },
  { t: 18.6, v: 0.468 },
  { t: 22.4, v: 0.532 },
  { t: 26.0, v: 0.625 },
  { t: 29.2, v: 0.72 },
  { t: 33.0, v: 0.702 },
  { t: 40.0, v: 0.682 },
];

function sampleNumber(keys, time) {
  if (time <= keys[0].t) return keys[0].v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (time <= b.t) {
      const u = smootherstep(0, 1, (time - a.t) / Math.max(0.0001, b.t - a.t));
      return THREE.MathUtils.lerp(a.v, b.v, u);
    }
  }
  return keys[keys.length - 1].v;
}

function samplePair(keys, time, targetP, targetQ) {
  if (time <= keys[0].t) {
    targetP.fromArray(keys[0].p);
    targetQ.fromArray(keys[0].q);
    return;
  }
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (time <= b.t) {
      const u = smootherstep(0, 1, (time - a.t) / Math.max(0.0001, b.t - a.t));
      targetP.set(
        THREE.MathUtils.lerp(a.p[0], b.p[0], u),
        THREE.MathUtils.lerp(a.p[1], b.p[1], u),
        THREE.MathUtils.lerp(a.p[2], b.p[2], u),
      );
      targetQ.set(
        THREE.MathUtils.lerp(a.q[0], b.q[0], u),
        THREE.MathUtils.lerp(a.q[1], b.q[1], u),
        THREE.MathUtils.lerp(a.q[2], b.q[2], u),
      );
      return;
    }
  }
  targetP.fromArray(keys[keys.length - 1].p);
  targetQ.fromArray(keys[keys.length - 1].q);
}

export function createFilm({ camera, world, weather }) {
  camera.fov = 42;
  camera.updateProjectionMatrix();

  const position = new THREE.Vector3();
  const target = new THREE.Vector3();
  let rainStarted = false;
  let boat0 = false;
  let boat1 = false;
  let boat2 = false;
  let lastTime = -1;

  function update(time) {
    const t = Math.max(0, Math.min(40, time));
    // Only trigger events when time moves forward, so stepping or rewinding
    // cannot fire the same cue twice.
    if (t >= lastTime) {
      if (!boat0 && t >= 5.0) { world.departBoat(0); boat0 = true; }
      if (!boat1 && t >= 6.35) { world.departBoat(1); boat1 = true; }
      if (!boat2 && t >= 7.6) { world.departBoat(2); boat2 = true; }
      if (!rainStarted && t >= 33.0) { weather.setMode('rain'); rainStarted = true; }
    }
    lastTime = t;

    samplePair(CAMERA_KEYS, t, position, target);
    camera.position.copy(position);
    camera.lookAt(target);
    camera.updateMatrixWorld();

    const dayTime = sampleNumber(DAY_KEYS, t);
    return { dayTime, finished: t >= 40, target, position };
  }

  return { update };
}
