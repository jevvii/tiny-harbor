import * as THREE from 'three';

const vertexShader = /* glsl */`
  uniform float uTime;
  uniform float uWind;
  varying vec3 vWorldPos;
  varying float vWave;
  #include <fog_pars_vertex>

  float waveHeight(vec2 p, float t) {
    float a = sin(p.x * 0.55 + t * 0.72) * 0.055;
    float b = sin(p.y * 0.71 - t * 0.52) * 0.042;
    float c = sin((p.x + p.y) * 1.62 + t * 1.16) * 0.016;
    return a + b + c;
  }

  void main() {
    vec3 p = position;
    float h = waveHeight(p.xz, uTime);
    p.y += h * (0.55 + uWind * 0.9);

    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorldPos = world.xyz;
    vWave = h;

    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */`
  uniform float uTime;
  uniform float uNight;
  uniform float uRain;
  uniform float uWind;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform float uLightStrength;
  uniform vec2 uBeachDir;
  uniform vec3 uFoamColor;
  varying vec3 vWorldPos;
  varying float vWave;
  #include <fog_pars_fragment>

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 p = vWorldPos.xz;
    float t = uTime;

    // A little cross-chop keeps the wave highlights from lining up into
    // regular horizontal bands, which read as scan lines at night.
    float dhx =
      cos(p.x * 0.55 + t * 0.72) * 0.055 * 0.55 +
      cos((p.x + p.y) * 1.62 + t * 1.16) * 0.016 * 1.62 +
      cos(p.x * 2.9 + p.y * 2.3 + t * 1.7) * 0.007 * 2.9 +
      cos(p.x * 1.7 - p.y * 2.1 - t * 1.1) * 0.006 * 1.7;
    float dhz =
      cos(p.y * 0.71 - t * 0.52) * 0.042 * 0.71 +
      cos((p.x + p.y) * 1.62 + t * 1.16) * 0.016 * 1.62 +
      cos(p.x * 2.9 + p.y * 2.3 + t * 1.7) * 0.007 * 2.3 -
      cos(p.x * 1.7 - p.y * 2.1 - t * 1.1) * 0.006 * 2.1;

    float bump = 2.6 - uNight * 2.35 - uRain * 0.2;
    vec3 n = normalize(vec3(-dhx * bump, 1.0, -dhz * bump));
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);

    float r = length(p);
    float shallowness = smoothstep(29.0, 16.7, r);
    vec3 base = mix(uDeep, uShallow, shallowness * 0.95 + 0.05);

    float ripple = sin(p.x * 2.3 + p.y * 1.7 + t * 1.4) * 0.02;
    base += vec3(ripple) * 0.5;

    vec3 reflectedSky = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 0.68, n.y * 0.6 + 0.3));
    vec3 col = mix(base, reflectedSky, fresnel * (0.52 - uNight * 0.34));

    float sunSpec = pow(max(dot(reflect(-uLightDir, n), viewDir), 0.0), 180.0);
    sunSpec += pow(max(dot(reflect(-uLightDir, n), viewDir), 0.0), 26.0) * 0.12;
    col += uLightColor * sunSpec * uLightStrength * 1.3;

    float waveLight = smoothstep(-0.04, 0.07, vWave);
    col += waveLight * 0.035 * (0.3 + uLightStrength) * (1.0 - uNight * 0.62);

    // Long soft bands that read as foam lines where the sea meets the beach.
    float angle = atan(p.y, p.x);
    float shoreBand = smoothstep(0.45, 0.0, abs(r - (17.25 + 0.32 * sin(angle * 9.0 + t * 0.7))));
    float beachMask = smoothstep(-0.15, 0.85, dot(normalize(p + 0.0001), uBeachDir));
    float foamBreak = smoothstep(0.15, 0.85, sin(angle * 21.0 - t * 1.5) * 0.45 + 0.5);
    float foam = shoreBand * mix(0.34, 1.0, beachMask) * (0.28 + 0.5 * foamBreak);

    // A thin broken rim makes the miniature read as a tide line from above.
    float rim = smoothstep(0.6, 0.0, abs(r - 19.3 - 0.35 * sin(angle * 13.0 + t * 0.4)));
    foam += rim * mix(0.08, 0.3, beachMask) * foamBreak;

    col = mix(col, uFoamColor, clamp(foam * (0.65 + 0.35 * (1.0 - uNight)), 0.0, 0.72));

    float rainPattern = hash21(floor(p * 7.0) + floor(t * 8.0)) * uRain * 0.035;
    col += rainPattern;

    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`;

export function createWater() {
  const geometry = new THREE.CircleGeometry(33, 160);
  geometry.rotateX(-Math.PI / 2);

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uNight: { value: 0 },
      uRain: { value: 0 },
      uWind: { value: 0.5 },
      uSkyTop: { value: new THREE.Color('#7fb8c9') },
      uSkyHorizon: { value: new THREE.Color('#dcefe5') },
      uShallow: { value: new THREE.Color('#79c4ba') },
      uDeep: { value: new THREE.Color('#3b8291') },
      uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uLightColor: { value: new THREE.Color('#fff2d3') },
      uLightStrength: { value: 1 },
      uBeachDir: { value: new THREE.Vector2(Math.cos(0.54), Math.sin(0.54)) },
      uFoamColor: { value: new THREE.Color('#fff5e3') },
    },
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    fog: true,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'The sea';
  mesh.position.y = 0.02;
  mesh.receiveShadow = false;
  mesh.renderOrder = 0;

  const shallowDay = new THREE.Color('#7cc8bb');
  const shallowNight = new THREE.Color('#275a73');
  const deepDay = new THREE.Color('#3b8492');
  const deepNight = new THREE.Color('#162f4f');
  const foamDay = new THREE.Color('#fff5e1');
  const foamNight = new THREE.Color('#aebfd1');
  const shallowWorking = new THREE.Color();
  const deepWorking = new THREE.Color();
  const foamWorking = new THREE.Color();

  function update({ time, sky, weather }) {
    uniforms.uTime.value = time;
    uniforms.uNight.value = sky.night;
    uniforms.uRain.value = weather.rain;
    uniforms.uWind.value = 0.5 + weather.rain * 0.9 + sky.wind * 0.55;
    uniforms.uSkyTop.value.copy(sky.skyTop);
    uniforms.uSkyHorizon.value.copy(sky.skyHorizon);
    uniforms.uLightDir.value.copy(sky.waterLightDir);
    uniforms.uLightColor.value.copy(sky.waterLightColor);
    uniforms.uLightStrength.value = sky.waterLightStrength;
    uniforms.uBeachDir.value.set(Math.cos(0.54), Math.sin(0.54));

    shallowWorking.lerpColors(shallowDay, shallowNight, Math.max(sky.night, weather.storm * 0.5));
    deepWorking.lerpColors(deepDay, deepNight, Math.max(sky.night, weather.storm * 0.42));
    foamWorking.lerpColors(foamDay, foamNight, sky.night);
    if (weather.rain > 0) {
      shallowWorking.lerp(new THREE.Color('#5b7c82'), weather.rain * 0.42);
      deepWorking.lerp(new THREE.Color('#294e5b'), weather.rain * 0.36);
    }
    if (sky.mist > 0.01) {
      shallowWorking.lerp(sky.skyHorizon, sky.mist * 0.22);
      deepWorking.lerp(sky.skyHorizon, sky.mist * 0.14);
    }
    uniforms.uShallow.value.copy(shallowWorking);
    uniforms.uDeep.value.copy(deepWorking);
    uniforms.uFoamColor.value.copy(foamWorking);
  }

  return { mesh, material, uniforms, update };
}
