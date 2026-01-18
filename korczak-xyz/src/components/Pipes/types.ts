import type * as THREE from 'three';

// Direction enum representing 6 cardinal directions in 3D space
export enum Direction {
  PosX = 0, // +X
  NegX = 1, // -X
  PosY = 2, // +Y
  NegY = 3, // -Y
  PosZ = 4, // +Z
  NegZ = 5, // -Z
}

// Integer grid position
export interface GridPosition {
  x: number;
  y: number;
  z: number;
}

// A single pipe with its state
export interface Pipe {
  headPosition: GridPosition;
  headDirection: Direction;
  color: THREE.Color;
  segments: THREE.Mesh[];
  joints: THREE.Mesh[];
  isAlive: boolean;
}

// Configuration for the pipes screensaver
export interface PipesConfig {
  gridSize: { x: number; y: number; z: number };
  pipeRadius: number;
  cellSize: number;
  maxPipes: number;
  growthSpeed: number; // cells per second
  turnProbability: number;
  colors: number[]; // hex colors
  cameraOrbitSpeed: number;
}

// Default configuration
export const DEFAULT_CONFIG: PipesConfig = {
  gridSize: { x: 16, y: 12, z: 16 },
  pipeRadius: 0.15,
  cellSize: 1,
  maxPipes: 6,
  growthSpeed: 8,
  turnProbability: 0.25,
  colors: [
    0xc0c0c0, // Silver
    0xffd700, // Gold
    0xb87333, // Copper
    0x50c878, // Emerald green
    0x4169e1, // Royal blue
    0x9932cc, // Dark orchid
    0xff4500, // Orange red
    0x40e0d0, // Turquoise
  ],
  cameraOrbitSpeed: 0.1,
};

// Direction vectors for each direction
export const DIRECTION_VECTORS: Record<Direction, GridPosition> = {
  [Direction.PosX]: { x: 1, y: 0, z: 0 },
  [Direction.NegX]: { x: -1, y: 0, z: 0 },
  [Direction.PosY]: { x: 0, y: 1, z: 0 },
  [Direction.NegY]: { x: 0, y: -1, z: 0 },
  [Direction.PosZ]: { x: 0, y: 0, z: 1 },
  [Direction.NegZ]: { x: 0, y: 0, z: -1 },
};

// Get the opposite direction
export function getOppositeDirection(dir: Direction): Direction {
  switch (dir) {
    case Direction.PosX:
      return Direction.NegX;
    case Direction.NegX:
      return Direction.PosX;
    case Direction.PosY:
      return Direction.NegY;
    case Direction.NegY:
      return Direction.PosY;
    case Direction.PosZ:
      return Direction.NegZ;
    case Direction.NegZ:
      return Direction.PosZ;
  }
}

// Get all directions except the opposite of the given direction
export function getValidTurnDirections(currentDir: Direction): Direction[] {
  const opposite = getOppositeDirection(currentDir);
  return [
    Direction.PosX,
    Direction.NegX,
    Direction.PosY,
    Direction.NegY,
    Direction.PosZ,
    Direction.NegZ,
  ].filter((d) => d !== opposite);
}

// Convert grid position to string key for Set/Map
export function positionKey(pos: GridPosition): string {
  return `${pos.x},${pos.y},${pos.z}`;
}

// Add two grid positions
export function addPositions(a: GridPosition, b: GridPosition): GridPosition {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

// Check if position is within grid bounds
export function isInBounds(
  pos: GridPosition,
  gridSize: { x: number; y: number; z: number }
): boolean {
  return (
    pos.x >= 0 &&
    pos.x < gridSize.x &&
    pos.y >= 0 &&
    pos.y < gridSize.y &&
    pos.z >= 0 &&
    pos.z < gridSize.z
  );
}
