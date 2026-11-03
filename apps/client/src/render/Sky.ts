import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { hexToUnit, PALETTE } from '@robmine/content';

/** Tageszyklus: 24 Minuten = 1440 Sekunden Spielzeit. */
export const DAY_SECONDS = 1440;

export interface SkyState {
  sunDir: Vector3;
  /** Sonnenhöhe −1..1 */
  elevation: number;
  zenith: Color;
  horizon: Color;
  sunColor: Color;
  /** 0 Nacht … 1 voller Tag */
  daylight: number;
  fogColor: Color;
  ambientSky: Color;
  ambientGround: Color;
  sunIntensity: number;
  hemiIntensity: number;
}

const KEY_NIGHT = {
  zenith: hexToUnit('#0B1230'),
  horizon: hexToUnit(PALETTE.skyNight),
  sun: hexToUnit(PALETTE.moonLight),
};
const KEY_DAWN = {
  zenith: hexToUnit('#5B4B8A'),
  horizon: hexToUnit(PALETTE.skyMorning),
  sun: hexToUnit(PALETTE.sunEvening),
};
const KEY_DAY = {
  zenith: hexToUnit(PALETTE.skyNoonZenith),
  horizon: hexToUnit(PALETTE.skyNoonHorizon),
  sun: hexToUnit(PALETTE.sunNoon),
};
const KEY_DUSK = {
  zenith: hexToUnit(PALETTE.skyEveningUpper),
  horizon: hexToUnit(PALETTE.skyEvening),
  sun: hexToUnit(PALETTE.sunEvening),
};

function mix3(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];
}

/** Berechnet Sonnenstand und Farbstimmung für eine Tageszeit (Sekunden 0–1440). */
export function computeSky(timeOfDay: number, out: SkyState): SkyState {
  const t = ((timeOfDay % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  // Sonnenaufgang 05:00 (300 s), Untergang 19:00 (1140 s) → Tag = 14 min.
  const dayStart = 300;
  const dayEnd = 1140;
  let phase: number;
  if (t >= dayStart && t <= dayEnd)
    phase = ((t - dayStart) / (dayEnd - dayStart)) * Math.PI; // 0..π
  else {
    const n = t > dayEnd ? t - dayEnd : t + (DAY_SECONDS - dayEnd);
    phase = Math.PI + (n / (DAY_SECONDS - (dayEnd - dayStart))) * Math.PI; // π..2π
  }
  const elevation = Math.sin(phase);
  // Sonne wandert von Osten (−x) nach Westen (+x), leicht nach Süden geneigt (+z).
  out.sunDir.set(-Math.cos(phase) * 0.85, elevation, 0.45).normalize();
  out.elevation = elevation;

  const daylight = smooth(-0.12, 0.25, elevation);
  const twilight = 1 - smooth(0.0, 0.35, Math.abs(elevation)); // stark um den Horizont
  const isMorning = t < 720;
  const twKey = isMorning ? KEY_DAWN : KEY_DUSK;

  let zenith = mix3(KEY_NIGHT.zenith, KEY_DAY.zenith, daylight);
  let horizon = mix3(KEY_NIGHT.horizon, KEY_DAY.horizon, daylight);
  zenith = mix3(zenith, twKey.zenith, twilight * 0.6);
  horizon = mix3(horizon, twKey.horizon, twilight * 0.85);
  const sun = mix3(twKey.sun, KEY_DAY.sun, smooth(0.05, 0.5, elevation));

  out.zenith.setRGB(zenith[0], zenith[1], zenith[2]);
  out.horizon.setRGB(horizon[0], horizon[1], horizon[2]);
  out.sunColor.setRGB(sun[0], sun[1], sun[2]);
  out.daylight = daylight;
  out.fogColor.copy(out.horizon);
  out.ambientSky.copy(out.zenith).lerp(out.horizon, 0.5);
  out.ambientGround.setRGB(0.42, 0.36, 0.3).multiplyScalar(0.35 + 0.65 * daylight);
  // Nacht nie schwarz: Mondlicht (bläulich) + kräftigeres Umgebungslicht.
  out.sunIntensity = 0.45 + 1.35 * daylight;
  out.hemiIntensity = 0.55 + 0.3 * daylight;
  if (daylight < 0.5) out.ambientSky.lerp(out.sunColor, 0.35 * (1 - daylight * 2));
  return out;
}

export function createSkyState(): SkyState {
  return {
    sunDir: new Vector3(0, 1, 0),
    elevation: 1,
    zenith: new Color(),
    horizon: new Color(),
    sunColor: new Color(),
    daylight: 1,
    fogColor: new Color(),
    ambientSky: new Color(),
    ambientGround: new Color(),
    sunIntensity: 2.5,
    hemiIntensity: 1,
  };
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // immer ganz hinten
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uDaylight;
uniform float uSunDisc;

float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

void main() {
  vec3 d = normalize( vDir );
  float h = d.y;
  float up = pow( clamp( h, 0.0, 1.0 ), 0.45 );
  vec3 col = mix( uHorizon, uZenith, up );
  // Unter dem Horizont: dunkler, Richtung Bodenfarbe
  col = mix( col, uZenith * 0.35, smoothstep( 0.0, -0.25, h ) );

  // Sonne: Scheibe + Glow
  float s = dot( d, uSunDir );
  float disc = smoothstep( 0.9988, 0.9996, s );
  float glow = pow( max( s, 0.0 ), 48.0 ) * 0.35 + pow( max( s, 0.0 ), 6.0 ) * 0.12;
  col += uSunColor * ( disc * uSunDisc * 3.0 + glow * ( 0.4 + 0.6 * uDaylight ) );

  // Sterne bei Nacht
  float night = 1.0 - uDaylight;
  if ( night > 0.01 && h > 0.0 ) {
    vec2 sp = d.xz / ( d.y + 0.25 ) * 180.0;
    vec2 cell = floor( sp );
    float r = hash12( cell );
    vec2 f = fract( sp ) - 0.5;
    float star = smoothstep( 0.08, 0.0, length( f ) ) * step( 0.985, r );
    col += vec3( star ) * night * ( 0.6 + 0.4 * hash12( cell + 7.0 ) ) * smoothstep( 0.0, 0.2, h );
  }
  gl_FragColor = vec4( col, 1.0 );
}
`;

/** Himmelskuppel: folgt der Kamera, wird immer ganz hinten gezeichnet. */
export class Sky {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: {
        uZenith: { value: new Color() },
        uHorizon: { value: new Color() },
        uSunColor: { value: new Color() },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uDaylight: { value: 1 },
        uSunDisc: { value: 1 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: true,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 48, 24), this.material);
    this.mesh.name = 'sky';
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.scale.setScalar(1200);
  }

  update(state: SkyState, cameraPosition: Vector3): void {
    const u = this.material.uniforms;
    (u['uZenith']!.value as Color).copy(state.zenith);
    (u['uHorizon']!.value as Color).copy(state.horizon);
    (u['uSunColor']!.value as Color).copy(state.sunColor);
    (u['uSunDir']!.value as Vector3).copy(state.sunDir);
    u['uDaylight']!.value = state.daylight;
    this.mesh.position.copy(cameraPosition);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
