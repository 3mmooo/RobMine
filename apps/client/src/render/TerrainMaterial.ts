import {
  Color,
  DoubleSide,
  FrontSide,
  MeshLambertMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { CSM } from 'three/addons/csm/CSM.js';

export type TerrainPass = 'opaque' | 'cutout' | 'fluid';

export interface TerrainUniforms {
  uBlockLightBoost: { value: number };
  uSkyLightFloor: { value: number };
  uTime: { value: number };
}

const NORMALS_GLSL = /* glsl */ `
const vec3 RM_NORMALS[6] = vec3[6](
  vec3( 1.0, 0.0, 0.0 ), vec3( -1.0, 0.0, 0.0 ),
  vec3( 0.0, 1.0, 0.0 ), vec3( 0.0, -1.0, 0.0 ),
  vec3( 0.0, 0.0, 1.0 ), vec3( 0.0, 0.0, -1.0 )
);
`;

const VERTEX_PARS = /* glsl */ `
attribute vec4 a_data;
attribute vec2 a_light;
varying vec4 vRmLight;
varying float vRmAo;
varying vec2 vRmQuadUv;
flat varying float vRmPattern;
flat varying float vRmFlags;
varying vec3 vRmWorldPos;
flat varying vec3 vRmWorldNormal;
uniform float uTime;
${NORMALS_GLSL}
`;

const VERTEX_NORMAL = /* glsl */ `
int rmNormalIndex = int( a_data.x + 0.5 ) & 7;
vec3 objectNormal = RM_NORMALS[ rmNormalIndex ];
// Chunk-Matrizen sind reine Translationen → Welt-Normale = Objekt-Normale.
vRmWorldNormal = objectNormal;
`;

const VERTEX_BEGIN = /* glsl */ `
vec3 transformed = vec3( position );
float rmFlags = floor( a_data.x / 8.0 );
int rmFlagBits = int( rmFlags + 0.5 );
#ifdef RM_FLUID
  if ( ( rmFlagBits & 2 ) != 0 ) {
    // Wasseroberfläche etwas absenken + sanfte Welle
    transformed.y -= 0.125 + 0.03 * sin( uTime * 1.3 + float( gl_VertexID ) * 0.7 );
  }
#endif
vRmFlags = rmFlags;
vRmAo = mod( a_data.y, 4.0 ) / 3.0;
vRmPattern = floor( a_data.y / 4.0 );
vRmQuadUv = a_data.zw;
vRmLight = vec4( floor( a_light.x / 16.0 ), mod( a_light.x, 16.0 ), floor( a_light.y / 16.0 ), mod( a_light.y, 16.0 ) ) / 15.0;
`;

const VERTEX_WORLDPOS = /* glsl */ `
#include <worldpos_vertex>
{
  vec4 rmWorld = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    rmWorld = batchingMatrix * rmWorld;
  #endif
  #ifdef USE_INSTANCING
    rmWorld = instanceMatrix * rmWorld;
  #endif
  vRmWorldPos = ( modelMatrix * rmWorld ).xyz;
}
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec4 vRmLight;
varying float vRmAo;
varying vec2 vRmQuadUv;
flat varying float vRmPattern;
flat varying float vRmFlags;
varying vec3 vRmWorldPos;
flat varying vec3 vRmWorldNormal;
uniform float uBlockLightBoost;
uniform float uSkyLightFloor;

float rmHash13( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}
`;

const FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
{
  // Blockzelle hinter der Fläche (Welt-Normale kommt als Varying aus dem Vertex-Shader).
  vec3 rmN = vRmWorldNormal;
  vec3 rmCell = floor( vRmWorldPos - rmN * 0.5 + 0.001 );
  float rmJ = rmHash13( rmCell );
  // ±4 % Helligkeit, leichte Farbton-Drift je Block gegen Monotonie
  diffuseColor.rgb *= 0.96 + 0.08 * rmJ;
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.02, 1.0, 0.98 ), rmJ - 0.5 );
  // Weicher Kantenbevel je Block (quad-lokale Koordinaten, fract = Blockgrenze)
  vec2 rmF = fract( vRmQuadUv );
  float rmEdge = min( min( rmF.x, 1.0 - rmF.x ), min( rmF.y, 1.0 - rmF.y ) );
  diffuseColor.rgb *= 0.93 + 0.07 * smoothstep( 0.0, 0.09, rmEdge );
  // Muster: Gras-Sprenkel (3), Stein-Korn (1) – subtil
  int rmPatternI = int( vRmPattern + 0.5 );
  if ( rmPatternI == 3 ) {
    float g = rmHash13( floor( vRmWorldPos * 4.0 ) );
    diffuseColor.rgb *= 0.97 + 0.06 * g;
  } else if ( rmPatternI == 1 ) {
    float g = rmHash13( floor( vRmWorldPos * 3.0 + 7.0 ) );
    diffuseColor.rgb *= 0.95 + 0.08 * g;
  }
}
`;

const FRAGMENT_OUTPUT = /* glsl */ `
{
  float rmSky = vRmLight.w;
  float rmSkyFactor = max( uSkyLightFloor, rmSky * rmSky );
  float rmAoK = mix( 0.55, 1.0, vRmAo );
  vec3 rmGlow = vRmLight.rgb * uBlockLightBoost;
  vec3 rmLit = outgoingLight * rmSkyFactor * rmAoK + diffuseColor.rgb * rmGlow * rmAoK;
  int rmFlagsI = int( vRmFlags + 0.5 );
  if ( ( rmFlagsI & 1 ) != 0 ) rmLit = diffuseColor.rgb * 1.6;
  #ifdef OPAQUE
    diffuseColor.a = 1.0;
  #endif
  gl_FragColor = vec4( rmLit, diffuseColor.a );
}
`;

export interface TerrainMaterialSet {
  opaque: MeshLambertMaterial;
  cutout: MeshLambertMaterial;
  fluid: MeshLambertMaterial;
  uniforms: TerrainUniforms;
}

/**
 * Terrain-Materialien: MeshLambertMaterial + onBeforeCompile (Vertex-Entpacken,
 * Voxellicht, AO, Blockjitter, Bevel) – kompatibel mit CSM-Schatten und Nebel.
 */
export function createTerrainMaterials(csm: CSM | null): TerrainMaterialSet {
  const uniforms: TerrainUniforms = {
    uBlockLightBoost: { value: 1.35 },
    uSkyLightFloor: { value: 0.02 },
    uTime: { value: 0 },
  };
  const opaque = createPassMaterial('opaque', csm, uniforms);
  const cutout = createPassMaterial('cutout', csm, uniforms);
  const fluid = createPassMaterial('fluid', csm, uniforms);
  return { opaque, cutout, fluid, uniforms };
}

function createPassMaterial(
  pass: TerrainPass,
  csm: CSM | null,
  uniforms: TerrainUniforms,
): MeshLambertMaterial {
  const material = new MeshLambertMaterial({
    vertexColors: true,
    color: new Color(0xffffff),
    side: pass === 'cutout' ? DoubleSide : FrontSide,
    transparent: pass === 'fluid',
    opacity: pass === 'fluid' ? 0.78 : 1,
    depthWrite: pass !== 'fluid',
    fog: true,
  });
  material.name = `terrain:${pass}`;
  material.defines = material.defines ?? {};
  if (pass === 'fluid') material.defines['RM_FLUID'] = '';

  // CSM installiert seinen eigenen onBeforeCompile – wir wickeln unseren Patch darum.
  if (csm) csm.setupMaterial(material);
  const csmHook = material.onBeforeCompile;

  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    if (csm) csmHook.call(material, shader, renderer);
    shader.uniforms['uBlockLightBoost'] = uniforms.uBlockLightBoost;
    shader.uniforms['uSkyLightFloor'] = uniforms.uSkyLightFloor;
    shader.uniforms['uTime'] = uniforms.uTime;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <beginnormal_vertex>', VERTEX_NORMAL)
      .replace('#include <begin_vertex>', VERTEX_BEGIN)
      .replace('#include <worldpos_vertex>', VERTEX_WORLDPOS);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', FRAGMENT_COLOR)
      .replace('#include <opaque_fragment>', FRAGMENT_OUTPUT);
  };
  // Eigener Cache-Key, damit three die Materialien nicht mit Standard-Lambert verwechselt.
  material.customProgramCacheKey = () => `rm-terrain-${pass}-${csm ? 'csm' : 'nocsm'}`;
  return material;
}
