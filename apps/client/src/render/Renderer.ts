import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { CHUNK_SIZE } from '@robmine/core';
import { computeSky, createSkyState, Sky, type SkyState } from './Sky.ts';
import { createTerrainMaterials, type TerrainMaterialSet } from './TerrainMaterial.ts';
import { ChunkBatch } from './ChunkBatch.ts';

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  radius: number;
  shadowMapSize: number;
  shadows: boolean;
  pixelRatio: number;
  cascades: number;
}

/** Nummeriert Shader-Quelltext für lesbare Compile-Fehler. */
function numberLines(src: string | null): string {
  return (src ?? '')
    .split('\n')
    .map((l, i) => `${String(i + 1).padStart(4)}: ${l}`)
    .join('\n');
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: { radius: 6, shadowMapSize: 1024, shadows: false, pixelRatio: 0.75, cascades: 2 },
  medium: { radius: 8, shadowMapSize: 1024, shadows: true, pixelRatio: 1, cascades: 3 },
  high: { radius: 12, shadowMapSize: 2048, shadows: true, pixelRatio: 1, cascades: 3 },
};

/**
 * Render-Fassade: WebGLRenderer, Szene, Kamera, Himmel, Nebel, Sonne (CSM),
 * Hemisphärenlicht und die drei Chunk-Batches (opak, cutout, Wasser).
 */
export class Renderer {
  readonly gl: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly sky = new Sky();
  readonly skyState: SkyState = createSkyState();
  readonly hemi: HemisphereLight;
  readonly csm: CSM | null;
  /** Sonne ohne Schatten (Stufe Niedrig); mit CSM übernehmen dessen Lichter. */
  readonly sun: DirectionalLight | null;
  readonly materials: TerrainMaterialSet;
  readonly opaque: ChunkBatch;
  readonly cutout: ChunkBatch;
  readonly fluid: ChunkBatch;
  readonly fog: Fog;
  readonly preset: QualityPreset;
  readonly canvas: HTMLCanvasElement;
  readonly quality: QualityLevel;
  private readonly sunDir = new Vector3();

  constructor(canvas: HTMLCanvasElement, quality: QualityLevel, radiusOverride?: number) {
    this.canvas = canvas;
    this.quality = quality;
    const preset = { ...QUALITY[quality] };
    if (radiusOverride) preset.radius = radiusOverride;
    this.preset = preset;

    this.gl = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.gl.debug.checkShaderErrors = true;
    this.gl.debug.onShaderError = (gl, program, vs, fs) => {
      console.error(
        `[Renderer] Shader-Fehler\nPROGRAM: ${gl.getProgramInfoLog(program)}\nVERTEX: ${gl.getShaderInfoLog(vs)}\nFRAGMENT: ${gl.getShaderInfoLog(fs)}`,
      );
      if (gl.getShaderParameter(vs, gl.COMPILE_STATUS) === false)
        console.error(numberLines(gl.getShaderSource(vs)));
      if (gl.getShaderParameter(fs, gl.COMPILE_STATUS) === false)
        console.error(numberLines(gl.getShaderSource(fs)));
    };
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 0.95;
    this.gl.shadowMap.enabled = preset.shadows;
    this.gl.shadowMap.type = PCFSoftShadowMap;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * preset.pixelRatio);
    this.gl.setSize(window.innerWidth, window.innerHeight, false);

    const viewDistance = preset.radius * CHUNK_SIZE;
    this.camera = new PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      Math.max(600, viewDistance * 1.6),
    );
    this.scene.add(this.camera);
    this.scene.add(this.sky.mesh);

    this.fog = new Fog(new Color(0xdceeff), viewDistance * 0.55, viewDistance * 0.95);
    this.scene.fog = this.fog;

    this.hemi = new HemisphereLight(0xbfe3ff, 0x6b5a46, 1);
    this.scene.add(this.hemi);

    if (preset.shadows) {
      this.csm = new CSM({
        maxFar: Math.min(220, viewDistance),
        cascades: preset.cascades,
        mode: 'practical',
        parent: this.scene,
        shadowMapSize: preset.shadowMapSize,
        lightDirection: new Vector3(-0.5, -1, -0.3).normalize(),
        camera: this.camera,
        lightIntensity: 2.5,
        lightMargin: 120,
      });
      this.csm.fade = true;
      for (const light of this.csm.lights) {
        light.shadow.normalBias = 0.04;
        light.shadow.bias = -0.0004;
      }
    } else {
      this.csm = null;
    }
    if (this.csm) {
      this.sun = null;
    } else {
      this.sun = new DirectionalLight(0xffffff, 2.5);
      this.sun.castShadow = false;
      this.sun.position.set(0.5, 1, 0.3);
      this.scene.add(this.sun, this.sun.target);
    }

    this.materials = createTerrainMaterials(this.csm);
    // Seiten à 1,5 M Vertices (≈ 22 MB Attribute + 9 MB Index je Seite); Kapazität wächst bei Bedarf.
    this.opaque = new ChunkBatch(this.materials.opaque, 'opaque', {
      pageVertices: 1_500_000,
      pageInstances: 2048,
      maxPages: 10,
      minReserveVertices: 512,
    });
    this.cutout = new ChunkBatch(this.materials.cutout, 'cutout', {
      pageVertices: 500_000,
      pageInstances: 2048,
      maxPages: 8,
      minReserveVertices: 256,
    });
    this.fluid = new ChunkBatch(this.materials.fluid, 'fluid', {
      pageVertices: 200_000,
      pageInstances: 1024,
      maxPages: 6,
      minReserveVertices: 128,
      castShadow: false,
      renderOrder: 10,
    });
    this.scene.add(this.opaque.group, this.cutout.group, this.fluid.group);

    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.csm?.updateFrustums();
  }

  /** Tageszeit anwenden: Himmel, Nebel, Sonne, Ambient. */
  setTimeOfDay(timeOfDay: number): void {
    const s = computeSky(timeOfDay, this.skyState);
    this.fog.color.copy(s.fogColor);
    this.gl.setClearColor(s.fogColor, 1);
    this.hemi.color.copy(s.ambientSky);
    this.hemi.groundColor.copy(s.ambientGround);
    this.hemi.intensity = s.hemiIntensity;
    if (this.csm) {
      // Schattenrichtung nie flacher als ~10°, sonst Streifenbildung.
      this.sunDir.copy(s.sunDir);
      if (this.sunDir.y < 0.17) this.sunDir.y = 0.17;
      this.sunDir.normalize();
      this.csm.lightDirection.copy(this.sunDir).negate();
      const intensity = s.sunIntensity;
      for (const light of this.csm.lights) {
        light.intensity = intensity;
        light.color.copy(s.sunColor);
      }
    }
    if (this.sun) {
      this.sunDir.copy(s.sunDir);
      if (this.sunDir.y < 0.1) this.sunDir.y = 0.1;
      this.sun.position.copy(this.sunDir).multiplyScalar(500);
      this.sun.target.position.set(0, 0, 0);
      this.sun.intensity = s.sunIntensity;
      this.sun.color.copy(s.sunColor);
    }
  }

  render(elapsedSeconds: number): void {
    this.materials.uniforms.uTime.value = elapsedSeconds;
    this.camera.updateMatrixWorld();
    this.sky.update(this.skyState, this.camera.position);
    this.csm?.update();
    this.gl.render(this.scene, this.camera);
  }

  get drawCalls(): number {
    return this.gl.info.render.calls;
  }

  get triangles(): number {
    return this.gl.info.render.triangles;
  }

  get geometries(): number {
    return this.gl.info.memory.geometries;
  }

  dispose(): void {
    this.opaque.dispose();
    this.cutout.dispose();
    this.fluid.dispose();
    this.sky.dispose();
    this.csm?.dispose();
    this.gl.dispose();
  }
}
