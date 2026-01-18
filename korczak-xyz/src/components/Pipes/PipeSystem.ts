import * as THREE from 'three';
import {
  Direction,
  DIRECTION_VECTORS,
  type GridPosition,
  type Pipe,
  type PipesConfig,
  addPositions,
  getOppositeDirection,
  getValidTurnDirections,
  isInBounds,
  positionKey,
} from './types';

export class PipeSystem {
  private config: PipesConfig;
  private scene: THREE.Scene;
  private occupiedCells: Set<string> = new Set();
  private pipes: Pipe[] = [];
  private materials: THREE.MeshStandardMaterial[] = [];
  private segmentGeometry: THREE.CylinderGeometry;
  private jointGeometry: THREE.SphereGeometry;
  private gridOffset: THREE.Vector3;

  constructor(config: PipesConfig, scene: THREE.Scene) {
    this.config = config;
    this.scene = scene;

    // Create shared geometries
    this.segmentGeometry = new THREE.CylinderGeometry(
      config.pipeRadius,
      config.pipeRadius,
      config.cellSize,
      16
    );
    this.jointGeometry = new THREE.SphereGeometry(
      config.pipeRadius * 1.2,
      16,
      16
    );

    // Create materials for each color
    this.materials = config.colors.map(
      (color) =>
        new THREE.MeshStandardMaterial({
          color,
          metalness: 0.8,
          roughness: 0.2,
        })
    );

    // Calculate offset to center grid in scene
    this.gridOffset = new THREE.Vector3(
      (-config.gridSize.x * config.cellSize) / 2,
      (-config.gridSize.y * config.cellSize) / 2,
      (-config.gridSize.z * config.cellSize) / 2
    );
  }

  // Convert grid position to world position
  private gridToWorld(pos: GridPosition): THREE.Vector3 {
    return new THREE.Vector3(
      pos.x * this.config.cellSize + this.config.cellSize / 2,
      pos.y * this.config.cellSize + this.config.cellSize / 2,
      pos.z * this.config.cellSize + this.config.cellSize / 2
    ).add(this.gridOffset);
  }

  // Get rotation for a pipe segment based on direction
  private getSegmentRotation(dir: Direction): THREE.Euler {
    switch (dir) {
      case Direction.PosX:
      case Direction.NegX:
        return new THREE.Euler(0, 0, Math.PI / 2);
      case Direction.PosY:
      case Direction.NegY:
        return new THREE.Euler(0, 0, 0);
      case Direction.PosZ:
      case Direction.NegZ:
        return new THREE.Euler(Math.PI / 2, 0, 0);
    }
  }

  // Get position for segment between two grid cells
  private getSegmentPosition(
    from: GridPosition,
    to: GridPosition
  ): THREE.Vector3 {
    return new THREE.Vector3(
      ((from.x + to.x) / 2) * this.config.cellSize + this.config.cellSize / 2,
      ((from.y + to.y) / 2) * this.config.cellSize + this.config.cellSize / 2,
      ((from.z + to.z) / 2) * this.config.cellSize + this.config.cellSize / 2
    ).add(this.gridOffset);
  }

  // Create a new pipe at a random position
  spawnPipe(): Pipe | null {
    if (this.pipes.filter((p) => p.isAlive).length >= this.config.maxPipes) {
      return null;
    }

    // Try to find a random empty starting position
    let attempts = 100;
    while (attempts > 0) {
      const pos: GridPosition = {
        x: Math.floor(Math.random() * this.config.gridSize.x),
        y: Math.floor(Math.random() * this.config.gridSize.y),
        z: Math.floor(Math.random() * this.config.gridSize.z),
      };

      if (!this.occupiedCells.has(positionKey(pos))) {
        const colorIndex = Math.floor(Math.random() * this.config.colors.length);
        const direction = Math.floor(Math.random() * 6) as Direction;

        const pipe: Pipe = {
          headPosition: pos,
          headDirection: direction,
          color: new THREE.Color(this.config.colors[colorIndex]),
          segments: [],
          joints: [],
          isAlive: true,
        };

        // Add initial joint at spawn point
        const jointMesh = new THREE.Mesh(
          this.jointGeometry,
          this.materials[colorIndex]
        );
        jointMesh.position.copy(this.gridToWorld(pos));
        this.scene.add(jointMesh);
        pipe.joints.push(jointMesh);

        this.occupiedCells.add(positionKey(pos));
        this.pipes.push(pipe);
        return pipe;
      }
      attempts--;
    }

    return null;
  }

  // Grow a single pipe by one cell
  growPipe(pipe: Pipe): boolean {
    if (!pipe.isAlive) return false;

    // Determine next direction
    let nextDirection = pipe.headDirection;
    const shouldTurn = Math.random() < this.config.turnProbability;

    if (shouldTurn) {
      const validDirections = getValidTurnDirections(pipe.headDirection);
      nextDirection =
        validDirections[Math.floor(Math.random() * validDirections.length)];
    }

    // Calculate next position
    const dirVector = DIRECTION_VECTORS[nextDirection];
    const nextPos = addPositions(pipe.headPosition, dirVector);

    // Check if move is valid
    if (
      !isInBounds(nextPos, this.config.gridSize) ||
      this.occupiedCells.has(positionKey(nextPos))
    ) {
      // Try all other valid directions
      const validDirs = getValidTurnDirections(pipe.headDirection);
      let foundValid = false;

      for (const dir of validDirs) {
        const testPos = addPositions(pipe.headPosition, DIRECTION_VECTORS[dir]);
        if (
          isInBounds(testPos, this.config.gridSize) &&
          !this.occupiedCells.has(positionKey(testPos))
        ) {
          nextDirection = dir;
          nextPos.x = testPos.x;
          nextPos.y = testPos.y;
          nextPos.z = testPos.z;
          foundValid = true;
          break;
        }
      }

      if (!foundValid) {
        pipe.isAlive = false;
        return false;
      }
    }

    // Find material index for this pipe
    const materialIndex = this.config.colors.findIndex(
      (c) => new THREE.Color(c).getHex() === pipe.color.getHex()
    );
    const material = this.materials[materialIndex >= 0 ? materialIndex : 0];

    // Create segment
    const segment = new THREE.Mesh(this.segmentGeometry, material);
    segment.position.copy(
      this.getSegmentPosition(pipe.headPosition, nextPos)
    );
    segment.rotation.copy(this.getSegmentRotation(nextDirection));
    this.scene.add(segment);
    pipe.segments.push(segment);

    // Create joint if direction changed
    if (nextDirection !== pipe.headDirection) {
      const joint = new THREE.Mesh(this.jointGeometry, material);
      joint.position.copy(this.gridToWorld(pipe.headPosition));
      this.scene.add(joint);
      pipe.joints.push(joint);
    }

    // Update pipe state
    this.occupiedCells.add(positionKey(nextPos));
    pipe.headPosition = nextPos;
    pipe.headDirection = nextDirection;

    return true;
  }

  // Update all pipes
  update(): void {
    // Grow each alive pipe
    for (const pipe of this.pipes) {
      if (pipe.isAlive) {
        this.growPipe(pipe);
      }
    }

    // Spawn new pipes if needed
    const alivePipes = this.pipes.filter((p) => p.isAlive).length;
    if (alivePipes < this.config.maxPipes) {
      // Chance to spawn a new pipe
      if (Math.random() < 0.3) {
        this.spawnPipe();
      }
    }
  }

  // Check if the system should reset
  shouldReset(): boolean {
    const totalCells =
      this.config.gridSize.x *
      this.config.gridSize.y *
      this.config.gridSize.z;
    const fillRatio = this.occupiedCells.size / totalCells;

    // Reset if grid is >70% full or all pipes are dead
    if (fillRatio > 0.7) return true;
    if (
      this.pipes.length > 0 &&
      this.pipes.every((p) => !p.isAlive) &&
      this.occupiedCells.size > totalCells * 0.1
    ) {
      return true;
    }

    return false;
  }

  // Clear all pipes and reset
  reset(): void {
    // Remove all meshes from scene
    for (const pipe of this.pipes) {
      for (const segment of pipe.segments) {
        this.scene.remove(segment);
        segment.geometry.dispose();
      }
      for (const joint of pipe.joints) {
        this.scene.remove(joint);
        joint.geometry.dispose();
      }
    }

    this.pipes = [];
    this.occupiedCells.clear();
  }

  // Get statistics
  getStats(): { pipeCount: number; cellsFilled: number; fillRatio: number } {
    const totalCells =
      this.config.gridSize.x *
      this.config.gridSize.y *
      this.config.gridSize.z;
    return {
      pipeCount: this.pipes.length,
      cellsFilled: this.occupiedCells.size,
      fillRatio: this.occupiedCells.size / totalCells,
    };
  }

  // Dispose of resources
  dispose(): void {
    this.reset();
    this.segmentGeometry.dispose();
    this.jointGeometry.dispose();
    for (const material of this.materials) {
      material.dispose();
    }
  }
}
