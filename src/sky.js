import * as THREE from 'three';
import { getGlowTexture, getStarTexture, mulberry32, smoothstep, TAU } from './util.js';

const skyVertex = /* glsl */`
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */`
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDirection;
  uniform float uSunGlow;
  uniform float uNight;
  varying vec3 vDirection;

  void main() {
    float height = clamp(vDirection.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(height, 0.52));

    float horizonBand = exp(-pow((vDirection.y - 0.018) * 8.0, 2.0));
    col = mix(col, uHorizon, horizonBand * 0.45);

    float sunDot = max(dot(normalize(vDirection), uSunDirection), 0.0);
    float halo = pow(sunDot, 7.0) * 0.24 + pow(sunDot, 90.0) * 0.55;
    col += uSunColor * halo * uSunGlow;

    // A quiet blue lift near the bottom keeps the floating sea lip from going muddy.
    col = mix(col, uHorizon * 0.82, smoothstep(0.05, -0.22, vDirection.y));

    gl_FragColor = vec4(col, 1.0);
  }
`;

const palette = [
  {
    t: 0.0,
    top: '#687fa5', horizon: '#f4c3aa', fog: '#dfc5bc', light: '#ffc994',
    sunIntensity: 0.48, moonIntensity: 0.1, hemiIntensity: 0.52,
    hemiSky: '#9fb1cf', hemiGround: '#8e9a86', exposure: 1.05,
  },
  {
    t: 0.075,
    top: '#7fa9c6', horizon: '#f7d1ae', fog: '#e2cfc2', light: '#ffd49f',
    sunIntensity: 1.2, moonIntensity: 0.0, hemiIntensity: 0.62,
    hemiSky: '#adc8d9', hemiGround: '#949f86', exposure: 1.04,
  },
  {
    t: 0.17,
    top: '#69add2', horizon: '#d9eee5', fog: '#cfe3dd', light: '#fff2d4',
    sunIntensity: 2.3, moonIntensity: 0.0, hemiIntensity: 0.72,
    hemiSky: '#b7dae6', hemiGround: '#94ae86', exposure: 1.0,
  },
  {
    t: 0.255,
    top: '#4fa2d4', horizon: '#c8edef', fog: '#c9e4e1', light: '#fff8e7',
    sunIntensity: 2.8, moonIntensity: 0.0, hemiIntensity: 0.8,
    hemiSky: '#c1e2ea', hemiGround: '#9bb78d', exposure: 0.98,
  },
  {
    t: 0.38,
    top: '#65abd1', horizon: '#d5ede5', fog: '#cee2db', light: '#fff0d0',
    sunIntensity: 2.4, moonIntensity: 0.0, hemiIntensity: 0.74,
    hemiSky: '#b7d8e4', hemiGround: '#98b087', exposure: 1.0,
  },
  {
    t: 0.465,
    top: '#77a8c7', horizon: '#f2caa2', fog: '#e7d2ba', light: '#ffd092',
    sunIntensity: 1.95, moonIntensity: 0.0, hemiIntensity: 0.66,
    hemiSky: '#b2cbd7', hemiGround: '#9a9e83', exposure: 1.02,
  },
  {
    t: 0.515,
    top: '#6c7fa7', horizon: '#f3ab7d', fog: '#dcb39d', light: '#ffb46d',
    sunIntensity: 1.36, moonIntensity: 0.02, hemiIntensity: 0.56,
    hemiSky: '#9faec3', hemiGround: '#8f8c7c', exposure: 1.03,
  },
  {
    t: 0.565,
    top: '#455a82', horizon: '#ce8f83', fog: '#a48f96', light: '#f7a678',
    sunIntensity: 0.45, moonIntensity: 0.1, hemiIntensity: 0.42,
    hemiSky: '#7587a3', hemiGround: '#5c665f', exposure: 1.03,
  },
  {
    t: 0.64,
    top: '#1d2b4a', horizon: '#4e5980', fog: '#34445e', light: '#b7c9e5',
    sunIntensity: 0.0, moonIntensity: 0.36, hemiIntensity: 0.3,
    hemiSky: '#5c6d91', hemiGround: '#2d3d46', exposure: 1.0,
  },
  {
    t: 0.75,
    top: '#111a33', horizon: '#273653', fog: '#1e2d44', light: '#b4c7e6',
    sunIntensity: 0.0, moonIntensity: 0.3, hemiIntensity: 0.26,
    hemiSky: '#4f6087', hemiGround: '#263640', exposure: 0.98,
  },
  {
    t: 0.885,
    top: '#2c3d5f', horizon: '#6d6a89', fog: '#4a506d', light: '#c0cce3',
    sunIntensity: 0.0, moonIntensity: 0.15, hemiIntensity: 0.3,
    hemiSky: '#637092', hemiGround: '#39474b', exposure: 1.0,
  },
  {
    t: 1.0,
    top: '#687fa5', horizon: '#f4c3aa', fog: '#dfc5bc', light: '#ffc994',
    sunIntensity: 0.48, moonIntensity: 0.1, hemiIntensity: 0.52,
    hemiSky: '#9fb1cf', hemiGround: '#8e9a86', exposure: 1.05,
  },
].map((stop) => ({
  ...stop,
  top: new THREE.Color(stop.top),
  horizon: new THREE.Color(stop.horizon),
  fog: new THREE.Color(stop.fog),
  light: new THREE.Color(stop.light),
  hemiSky: new THREE.Color(stop.hemiSky),
  hemiGround: new THREE.Color(stop.hemiGround),
}));

const rainTop = new THREE.Color('#586c7c');
const rainHorizon = new THREE.Color('#aeb9b3');
const rainFog = new THREE.Color('#8e9b98');
const snowTop = new THREE.Color('#8998a9');
const snowHorizon = new THREE.Color('#d6dbd8');
const snowFog = new THREE.Color('#bec6c4');

let moonTexture;

function getMoonTexture() {
  if (moonTexture) return moonTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const glow = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.68, 'rgba(248,244,228,1)');
  glow.addColorStop(0.74, 'rgba(240,235,214,.55)');
  glow.addColorStop(1, 'rgba(240,235,214,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.globalCompositeOperation = 'source-atop';
  const rng = mulberry32(912);
  for (let i = 0; i < 14; i++) {
    const angle = rng() * TAU;
    const radius = Math.sqrt(rng()) * 72;
    const crater = 3 + rng() * 9;
    ctx.fillStyle = `rgba(164,170,162,${0.22 + rng() * 0.26})`;
    ctx.beginPath();
    ctx.arc(size / 2 + Math.cos(angle) * radius, size / 2 + Math.sin(angle) * radius, crater, 0, TAU);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  moonTexture = texture;
  return texture;
}

function buildStars(seed, count, size, radius) {
  const rng = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = rng() * TAU;
    // The default view looks down at the plinth, so the visible backdrop sits
    // just under the celestial horizon. Bias the field low so the night sky
    // above the island is properly speckled rather than empty.
    const y = -0.14 + Math.pow(rng(), 2.1) * 1.08;
    const r = Math.sqrt(Math.max(0.02, 1 - y * y));
    positions[i * 3] = Math.cos(theta) * r * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = Math.sin(theta) * r * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    size,
    map: getStarTexture(),
    color: 0xf7f1df,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    fog: false,
  });
  return new THREE.Points(geometry, material);
}

function sampleStop(dayTime) {
  let i = 0;
  while (i < palette.length - 2 && dayTime > palette[i + 1].t) i++;
  const a = palette[i];
  const b = palette[i + 1];
  const span = b.t - a.t;
  const u = smoothstep(0, 1, span > 0 ? (dayTime - a.t) / span : 0);
  return { a, b, u };
}

export function createSky(scene, renderer) {
  const uniforms = {
    uTop: { value: new THREE.Color('#7fa9c6') },
    uHorizon: { value: new THREE.Color('#f7d1ae') },
    uSunColor: { value: new THREE.Color('#ffd49f') },
    uSunDirection: { value: new THREE.Vector3(0.3, 0.7, 0.4) },
    uSunGlow: { value: 1 },
    uNight: { value: 0 },
  };

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(400, 48, 28),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  scene.add(dome);

  const starField = buildStars(21, 850, 1.25, 300);
  starField.renderOrder = -90;
  scene.add(starField);
  const brightStars = buildStars(82, 150, 2.1, 301);
  brightStars.renderOrder = -90;
  scene.add(brightStars);

  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color: '#ffd9a0',
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: true,
    fog: false,
    blending: THREE.AdditiveBlending,
  }));
  sunGlow.scale.set(76, 76, 1);
  sunGlow.renderOrder = -80;
  scene.add(sunGlow);

  const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getStarTexture(),
    color: '#fff3cf',
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: true,
    fog: false,
    blending: THREE.AdditiveBlending,
  }));
  sunCore.scale.set(18, 18, 1);
  sunCore.renderOrder = -79;
  scene.add(sunCore);

  const moon = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getMoonTexture(),
    color: '#f3f1df',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    fog: false,
  }));
  moon.scale.set(17, 17, 1);
  moon.renderOrder = -79;
  scene.add(moon);

  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color: '#a9c3eb',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    fog: false,
    blending: THREE.AdditiveBlending,
  }));
  moonHalo.scale.set(46, 46, 1);
  moonHalo.renderOrder = -80;
  scene.add(moonHalo);

  const hemi = new THREE.HemisphereLight('#b7dae6', '#94ae86', 0.75);
  scene.add(hemi);

  const sunLight = new THREE.DirectionalLight('#fff8e7', 2.6);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -32;
  sunLight.shadow.camera.right = 32;
  sunLight.shadow.camera.top = 32;
  sunLight.shadow.camera.bottom = -32;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 140;
  sunLight.shadow.bias = -0.00025;
  sunLight.shadow.normalBias = 0.035;
  sunLight.shadow.radius = 2.2;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const moonLight = new THREE.DirectionalLight('#b8cce9', 0);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(1024, 1024);
  moonLight.shadow.camera.left = -30;
  moonLight.shadow.camera.right = 30;
  moonLight.shadow.camera.top = 30;
  moonLight.shadow.camera.bottom = -30;
  moonLight.shadow.camera.near = 1;
  moonLight.shadow.camera.far = 140;
  moonLight.shadow.bias = -0.0003;
  moonLight.shadow.normalBias = 0.04;
  moonLight.shadow.radius = 3;
  scene.add(moonLight);
  scene.add(moonLight.target);

  const fog = new THREE.FogExp2('#cfe3dd', 0.0042);
  scene.fog = fog;

  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();
  // The moon hangs in the visible backdrop band above the island rather than
  // at the physical zenith, where the diorama camera could never see it.
  const moonVisualDir = new THREE.Vector3(-0.60, 0.12, -0.79).normalize();
  const state = {
    night: 0,
    sunElevation: 0,
    sunDir,
    moonDir,
    lightDir: new THREE.Vector3(),
    lightColor: new THREE.Color('#fff8e7'),
    lightStrength: 2.5,
    skyTop: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    fogColor: new THREE.Color(),
    fogDensity: 0.0042,
    mist: 0,
    storm: 0,
    rain: 0,
    snow: 0,
    wind: 0.4,
    waterLightDir: new THREE.Vector3(),
    waterLightColor: new THREE.Color(),
    waterLightStrength: 1,
    exposure: 1,
  };

  const working = {
    top: new THREE.Color(),
    horizon: new THREE.Color(),
    fog: new THREE.Color(),
    light: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    stormTop: new THREE.Color(),
    stormHorizon: new THREE.Color(),
    stormFog: new THREE.Color(),
  };

  function sampleColor(prop, target) {
    const { a, b, u } = sampleStop(dayTimeState);
    return target.copy(a[prop]).lerp(b[prop], u);
  }

  function sampleNumber(prop) {
    const { a, b, u } = sampleStop(dayTimeState);
    return THREE.MathUtils.lerp(a[prop], b[prop], u);
  }

  let dayTimeState = 0.175;
  let elapsed = 0;

  function update(dayTime, weather) {
    dayTimeState = ((dayTime % 1) + 1) % 1;
    elapsed += 1;
    const angle = dayTimeState * TAU;
    sunDir.set(Math.cos(angle), Math.sin(angle), 0.34).normalize();
    moonDir.set(-sunDir.x, -sunDir.y, -0.34).normalize();

    const sunElevation = sunDir.y;
    const night = smoothstep(0.0, -0.5, sunElevation);
    const storm = weather?.storm ?? 0;
    const rain = weather?.rain ?? 0;
    const snow = weather?.snow ?? 0;
    const dawnDistance = Math.min(dayTimeState, Math.abs(1 - dayTimeState));
    const dawn = 1 - smoothstep(0.0, 0.085, dawnDistance);
    const duskMist = smoothstep(0.48, 0.53, dayTimeState) * (1 - smoothstep(0.57, 0.63, dayTimeState)) * 0.32;
    const mist = Math.max(dawn, duskMist) * (1 - storm * 0.6);

    const top = sampleColor('top', working.top);
    const horizon = sampleColor('horizon', working.horizon);
    const fogColor = sampleColor('fog', working.fog);
    const lightColor = sampleColor('light', working.light);
    sampleColor('hemiSky', working.hemiSky);
    sampleColor('hemiGround', working.hemiGround);

    const sunIntensity = sampleNumber('sunIntensity');
    const moonIntensity = sampleNumber('moonIntensity');
    const hemiIntensity = sampleNumber('hemiIntensity');
    const baseExposure = sampleNumber('exposure');

    if (storm > 0.001) {
      working.stormTop.lerpColors(rainTop, snowTop, snow);
      working.stormHorizon.lerpColors(rainHorizon, snowHorizon, snow);
      working.stormFog.lerpColors(rainFog, snowFog, snow);
      top.lerp(working.stormTop, storm * 0.62);
      horizon.lerp(working.stormHorizon, storm * 0.56);
      fogColor.lerp(working.stormFog, storm * 0.55);
      lightColor.lerp(new THREE.Color('#e8e3d4'), storm * 0.32);
    }

    // Let the moon's cool light touch the scene before the sky goes fully dark.
    if (night > 0.01) {
      lightColor.lerp(new THREE.Color('#b9cae7'), night * 0.6);
    }

    const effectiveSun = sunIntensity * (1 - night) * (1 - storm * 0.48);
    const effectiveMoon = (moonIntensity + night * 0.12) * (1 - storm * 0.38);
    const fogDensity = 0.0031 + mist * 0.0028 + storm * 0.0026 + rain * 0.0010;
    const exposure = baseExposure * (1 - storm * 0.12) + night * 0.03;

    state.night = night;
    state.sunElevation = sunElevation;
    state.mist = mist;
    state.storm = storm;
    state.rain = rain;
    state.snow = snow;
    state.skyTop.copy(top);
    state.skyHorizon.copy(horizon);
    state.fogColor.copy(fogColor);
    state.fogDensity = fogDensity;
    state.lightColor.copy(lightColor);
    state.exposure = exposure;
    state.wind = 0.38 + storm * 0.85 + Math.max(0, sunElevation) * 0.18;
    state.sunDir.copy(sunDir);
    state.moonDir.copy(moonDir);
    state.lightDir.copy(night > 0.55 ? moonDir : sunDir);
    state.lightStrength = Math.max(effectiveSun, effectiveMoon);

    uniforms.uTop.value.copy(top);
    uniforms.uHorizon.value.copy(horizon);
    uniforms.uSunColor.value.copy(lightColor);
    uniforms.uSunDirection.value.copy(sunDir);
    uniforms.uSunGlow.value = (1 - storm * 0.6) * smoothstep(-0.12, 0.04, sunElevation);
    uniforms.uNight.value = night;

    starField.material.opacity = night * (1 - storm * 0.88);
    brightStars.material.opacity = night * (1 - storm * 0.88);
    starField.rotation.y += 0.000015;
    brightStars.rotation.y += 0.000012;

    sunGlow.position.copy(sunDir).multiplyScalar(330);
    sunCore.position.copy(sunDir).multiplyScalar(329);
    moon.position.copy(moonVisualDir).multiplyScalar(322);
    moonHalo.position.copy(moonVisualDir).multiplyScalar(320);
    const sunVisible = smoothstep(-0.035, 0.035, sunElevation) * (1 - storm * 0.75);
    sunGlow.material.opacity = sunVisible;
    sunCore.material.opacity = sunVisible;
    sunGlow.scale.setScalar(70 + (1 - Math.max(0, sunElevation)) * 58);
    sunCore.scale.setScalar(15 + (1 - Math.max(0, sunElevation)) * 6);
    moon.material.opacity = night * (1 - storm * 0.7);
    moonHalo.material.opacity = night * 0.3 * (1 - storm * 0.6);
    moon.scale.setScalar(17 + (1 - night) * 3);

    sunLight.color.copy(lightColor);
    sunLight.intensity = effectiveSun;
    sunLight.position.copy(sunDir).multiplyScalar(64);
    sunLight.target.position.set(0, 0, 0);

    moonLight.color.set('#b7cbe9');
    moonLight.intensity = effectiveMoon;
    moonLight.position.copy(moonDir).multiplyScalar(64);
    moonLight.target.position.set(0, 0, 0);

    hemi.color.copy(working.hemiSky);
    hemi.groundColor.copy(working.hemiGround);
    hemi.intensity = hemiIntensity * (1 - storm * 0.15) * (0.85 + night * 0.15);

    fog.color.copy(fogColor);
    fog.density = fogDensity;

    renderer.toneMappingExposure = exposure;

    state.waterLightDir.copy(night > 0.5 ? moonDir : sunDir);
    state.waterLightColor.copy(night > 0.5 ? new THREE.Color('#c0d3ec') : lightColor);
    state.waterLightStrength = Math.max(0.12, Math.min(1.6, effectiveSun * 0.65 + effectiveMoon * 0.5));

    return state;
  }

  return { state, update, sunLight, moonLight, hemi, dome, fog };
}
