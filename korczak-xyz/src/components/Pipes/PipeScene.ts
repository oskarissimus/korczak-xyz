import * as THREE from 'three';
import { DEFAULT_CONFIG, type PipesConfig } from './types';
import { PipeSystem } from './PipeSystem';

export class PipeScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private pipeSystem: PipeSystem;
  private config: PipesConfig;

  private animationId: number | null = null;
  private lastTime: number = 0;
  private timeSinceLastGrow: number = 0;
  private cameraAngle: number = 0;
  private isPaused: boolean = false;

  constructor(canvas: HTMLCanvasElement, config: Partial<PipesConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000);

    // Create scene
    this.scene = new THREE.Scene();

    // Create camera
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    this.updateCameraPosition();

    // Set up lighting
    this.setupLighting();

    // Create pipe system
    this.pipeSystem = new PipeSystem(this.config, this.scene);

    // Initial resize
    this.resize(canvas.clientWidth, canvas.clientHeight);
  }

  private setupLighting(): void {
    // Ambient light for base illumination
    const ambient = new THREE.AmbientLight(0x404040, 0.5);
    this.scene.add(ambient);

    // Main directional light
    const mainLight = new THREE.DirectionalLight(0xffffff, 1);
    mainLight.position.set(10, 20, 10);
    this.scene.add(mainLight);

    // Fill light from opposite side
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.5);
    fillLight.position.set(-10, -5, -10);
    this.scene.add(fillLight);

    // Top light for metallic highlights
    const topLight = new THREE.DirectionalLight(0xffffff, 0.3);
    topLight.position.set(0, 30, 0);
    this.scene.add(topLight);
  }

  private updateCameraPosition(): void {
    const radius = Math.max(
      this.config.gridSize.x,
      this.config.gridSize.y,
      this.config.gridSize.z
    ) * 1.5;

    this.camera.position.x = Math.cos(this.cameraAngle) * radius;
    this.camera.position.z = Math.sin(this.cameraAngle) * radius;
    this.camera.position.y = radius * 0.5;
    this.camera.lookAt(0, 0, 0);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    if (this.animationId !== null) return;

    // Spawn initial pipes
    for (let i = 0; i < 3; i++) {
      this.pipeSystem.spawnPipe();
    }

    this.lastTime = performance.now();
    this.animate();
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);

    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    if (!this.isPaused) {
      // Update camera orbit
      this.cameraAngle += this.config.cameraOrbitSpeed * deltaTime;
      this.updateCameraPosition();

      // Grow pipes based on growth speed
      this.timeSinceLastGrow += deltaTime;
      const growInterval = 1 / this.config.growthSpeed;

      while (this.timeSinceLastGrow >= growInterval) {
        this.pipeSystem.update();
        this.timeSinceLastGrow -= growInterval;
      }

      // Check for reset
      if (this.pipeSystem.shouldReset()) {
        this.pipeSystem.reset();
        // Spawn new pipes after reset
        for (let i = 0; i < 3; i++) {
          this.pipeSystem.spawnPipe();
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  pause(): void {
    this.isPaused = true;
  }

  play(): void {
    this.isPaused = false;
    this.lastTime = performance.now();
  }

  togglePause(): boolean {
    if (this.isPaused) {
      this.play();
    } else {
      this.pause();
    }
    return this.isPaused;
  }

  reset(): void {
    this.pipeSystem.reset();
    this.cameraAngle = 0;
    this.updateCameraPosition();
    // Spawn initial pipes
    for (let i = 0; i < 3; i++) {
      this.pipeSystem.spawnPipe();
    }
  }

  getIsPaused(): boolean {
    return this.isPaused;
  }

  getStats(): { pipeCount: number; cellsFilled: number; fillRatio: number } {
    return this.pipeSystem.getStats();
  }

  dispose(): void {
    this.stop();
    this.pipeSystem.dispose();
    this.renderer.dispose();
  }
}
