import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Card } from '../../utils/solitaire/types';
import { SUIT_SYMBOLS, SUIT_COLORS } from '../../utils/solitaire/types';

interface WinAnimationProps {
  foundations: [Card[], Card[], Card[], Card[]];
  onComplete: () => void;
}

interface AnimatedCard {
  card: Card;
  x: number;
  y: number;
  vx: number;
  vy: number;
  bounceDampen: number; // Per-card bounce dampening for varied heights
  active: boolean;
  launched: boolean;
}

// Trail stored as simple data
interface TrailData {
  x: number;
  y: number;
  suit: string;
  rank: string;
  color: string;
}

// Physics constants
const GRAVITY = 0.3;
const TRAIL_INTERVAL = 2;
const LAUNCH_INTERVAL = 4;
const CARD_WIDTH = 70;
const CARD_HEIGHT = 100;
const MAX_FRAMES = 800;

// Helper to draw rounded rectangle on canvas
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function WinAnimation({ foundations, onComplete }: WinAnimationProps) {
  // Canvas size state (only thing that needs React re-render)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // All animation data in refs - NO setState during animation!
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animatedCardsRef = useRef<AnimatedCard[]>([]);
  const trailsRef = useRef<TrailData[]>([]);
  const lastTrailCountRef = useRef(0);
  const frameRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const cardDimensionsRef = useRef({ width: CARD_WIDTH, height: CARD_HEIGHT });

  // Force re-render trigger for active cards display
  const [renderTick, setRenderTick] = useState(0);

  // Get responsive card dimensions
  const updateCardDimensions = useCallback(() => {
    const width = window.innerWidth;
    if (width <= 600) {
      cardDimensionsRef.current = { width: 42, height: 60 };
    } else if (width <= 900) {
      cardDimensionsRef.current = { width: 55, height: 80 };
    } else {
      cardDimensionsRef.current = { width: CARD_WIDTH, height: CARD_HEIGHT };
    }
  }, []);

  // Initialize canvas size and buffer canvas
  useEffect(() => {
    const updateCanvasSize = () => {
      const newWidth = window.innerWidth;
      const newHeight = window.innerHeight;

      setCanvasSize({ width: newWidth, height: newHeight });
      updateCardDimensions();

      // Create/resize buffer canvas
      if (!bufferCanvasRef.current) {
        bufferCanvasRef.current = document.createElement('canvas');
      }
      bufferCanvasRef.current.width = newWidth;
      bufferCanvasRef.current.height = newHeight;
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, [updateCardDimensions]);

  // Draw a single trail card to canvas
  const drawSingleTrail = useCallback((ctx: CanvasRenderingContext2D, trail: TrailData) => {
    const { width: cardW, height: cardH } = cardDimensionsRef.current;
    const textColor = trail.color === 'red' ? '#c00000' : '#000000';

    // Draw card background with border
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, trail.x, trail.y, cardW, cardH, 4);
    ctx.fill();

    ctx.strokeStyle = '#dfdfdf';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = textColor;

    // Draw top-left corner (rank + suit)
    const cornerFontSize = Math.floor(cardH * 0.18);
    ctx.font = `bold ${cornerFontSize}px VT323, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(trail.rank, trail.x + 4, trail.y + 3);
    ctx.fillText(trail.suit, trail.x + 4, trail.y + 3 + cornerFontSize);

    // Draw bottom-right corner (rotated 180°)
    ctx.save();
    ctx.translate(trail.x + cardW - 4, trail.y + cardH - 3);
    ctx.rotate(Math.PI);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(trail.rank, 0, 0);
    ctx.fillText(trail.suit, 0, cornerFontSize);
    ctx.restore();

    // Draw suit symbol in center
    ctx.font = `bold ${Math.floor(cardH * 0.35)}px VT323, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(trail.suit, trail.x + cardW / 2, trail.y + cardH / 2);
  }, []);

  // Draw only NEW trails to buffer (incremental!)
  const drawNewTrailsToBuffer = useCallback(() => {
    const bufferCtx = bufferCanvasRef.current?.getContext('2d');
    if (!bufferCtx) return;

    const trails = trailsRef.current;
    const startIdx = lastTrailCountRef.current;

    // Only draw trails added since last frame
    for (let i = startIdx; i < trails.length; i++) {
      drawSingleTrail(bufferCtx, trails[i]);
    }

    lastTrailCountRef.current = trails.length;
  }, [drawSingleTrail]);

  // Initialize cards from foundations
  useEffect(() => {
    if (canvasSize.width === 0) return;

    const screenWidth = canvasSize.width;
    const { width: cardWidth } = cardDimensionsRef.current;

    // Starting position - top right area where foundations are
    const startX = screenWidth - cardWidth * 4 - 60;
    const startY = 80;

    // Collect all cards from foundations, interleaving suits for visual variety
    const allCards: { card: Card; foundationIndex: number }[] = [];
    const maxLen = Math.max(...foundations.map(f => f.length));

    for (let i = 0; i < maxLen; i++) {
      for (let f = 0; f < 4; f++) {
        if (foundations[f][i]) {
          allCards.push({ card: foundations[f][i], foundationIndex: f });
        }
      }
    }

    // Create animated card objects with randomized energy for chaotic effect
    animatedCardsRef.current = allCards.map(({ card, foundationIndex }, index) => {
      // Randomize direction (not just alternating)
      const goRight = Math.random() > 0.5;
      // More varied horizontal velocity (1-6 px/frame)
      const baseVx = 1 + Math.random() * 5;
      // More varied initial upward velocity (-0.5 to -4)
      const baseVy = -0.5 - Math.random() * 3.5;
      // Per-card bounce dampening (0.7-0.95) - creates varied bounce heights
      const bounceDampen = 0.7 + Math.random() * 0.25;

      return {
        card,
        x: startX + foundationIndex * (cardWidth + 10),
        y: startY,
        vx: goRight ? baseVx : -baseVx,
        vy: baseVy,
        bounceDampen,
        active: true,
        launched: false,
      };
    });

    // Reset animation state
    trailsRef.current = [];
    lastTrailCountRef.current = 0;
    frameRef.current = 0;
    completedRef.current = false;

    // Clear buffer canvas
    const bufferCtx = bufferCanvasRef.current?.getContext('2d');
    if (bufferCtx && bufferCanvasRef.current) {
      bufferCtx.clearRect(0, 0, bufferCanvasRef.current.width, bufferCanvasRef.current.height);
    }

    // Trigger initial render
    setRenderTick(1);
  }, [foundations, canvasSize.width]);

  // Animation loop - runs entirely in refs, minimal React involvement
  useEffect(() => {
    if (animatedCardsRef.current.length === 0 || canvasSize.width === 0) return;

    const screenWidth = canvasSize.width;
    const screenHeight = canvasSize.height;
    const { width: cardWidth, height: cardHeight } = cardDimensionsRef.current;

    let lastRenderTick = 0;

    const animate = () => {
      frameRef.current++;

      const cards = animatedCardsRef.current;
      let hasActiveCards = false;
      let needsRerender = false;

      // Update physics for all cards (in ref, no setState!)
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];

        // Launch cards one at a time
        if (!card.launched) {
          if (frameRef.current >= i * LAUNCH_INTERVAL) {
            card.launched = true;
            needsRerender = true;
          }
          continue;
        }

        if (!card.active) continue;

        hasActiveCards = true;

        // Add to persistent trail every few frames
        if (frameRef.current % TRAIL_INTERVAL === 0) {
          trailsRef.current.push({
            x: card.x,
            y: card.y,
            suit: SUIT_SYMBOLS[card.card.suit],
            rank: card.card.rank,
            color: SUIT_COLORS[card.card.suit],
          });
        }

        // Update physics
        card.vy += GRAVITY;
        card.x += card.vx;
        card.y += card.vy;

        // Bounce off bottom - use per-card dampening for varied heights
        if (card.y > screenHeight - cardHeight) {
          card.y = screenHeight - cardHeight;
          card.vy = -Math.abs(card.vy) * card.bounceDampen;
          // Apply friction when touching ground - stops sliding quickly
          card.vx *= 0.85;
        }

        // Bounce off sides
        if (card.x < 0) {
          card.x = 0;
          card.vx = Math.abs(card.vx) * 0.9;
        } else if (card.x > screenWidth - cardWidth) {
          card.x = screenWidth - cardWidth;
          card.vx = -Math.abs(card.vx) * 0.9;
        }

        // Check if card energy is depleted
        const totalEnergy = Math.abs(card.vx) + Math.abs(card.vy);
        const atBottom = card.y >= screenHeight - cardHeight - 10;
        if (totalEnergy < 2 && atBottom) {
          card.active = false;
          needsRerender = true;
        }
      }

      // Draw new trails to buffer (incremental - only new ones!)
      drawNewTrailsToBuffer();

      // Copy buffer to visible canvas + draw active cards
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && bufferCanvasRef.current) {
        // Clear and copy buffer (single drawImage is fast!)
        ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
        ctx.drawImage(bufferCanvasRef.current, 0, 0);

        // Draw active cards directly on main canvas (skip React for moving cards)
        for (const card of cards) {
          if (!card.launched || !card.active) continue;

          const { width: cardW, height: cardH } = cardDimensionsRef.current;
          const suitSymbol = SUIT_SYMBOLS[card.card.suit];
          const textColor = SUIT_COLORS[card.card.suit] === 'red' ? '#c00000' : '#000000';

          // Draw card background
          ctx.fillStyle = '#ffffff';
          roundRect(ctx, card.x, card.y, cardW, cardH, 4);
          ctx.fill();

          // Draw border (outset effect)
          ctx.strokeStyle = '#dfdfdf';
          ctx.lineWidth = 3;
          ctx.stroke();

          ctx.fillStyle = textColor;

          // Draw corners
          const cornerFontSize = Math.floor(cardH * 0.18);
          ctx.font = `bold ${cornerFontSize}px VT323, monospace`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(card.card.rank, card.x + 4, card.y + 3);
          ctx.fillText(suitSymbol, card.x + 4, card.y + 3 + cornerFontSize);

          // Bottom-right corner
          ctx.save();
          ctx.translate(card.x + cardW - 4, card.y + cardH - 3);
          ctx.rotate(Math.PI);
          ctx.fillText(card.card.rank, 0, 0);
          ctx.fillText(suitSymbol, 0, cornerFontSize);
          ctx.restore();

          // Center suit
          ctx.font = `bold ${Math.floor(cardH * 0.35)}px VT323, monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(suitSymbol, card.x + cardW / 2, card.y + cardH / 2);
        }
      }

      // Check if animation is complete
      const allLaunched = cards.every(c => c.launched);
      const allInactive = !hasActiveCards && allLaunched;
      const maxFramesReached = frameRef.current >= MAX_FRAMES;

      if ((allInactive || maxFramesReached) && !completedRef.current) {
        completedRef.current = true;
        setTimeout(() => {
          onComplete();
        }, 300);
      }

      // Only trigger React re-render occasionally (for cleanup/completion)
      if (needsRerender && frameRef.current - lastRenderTick > 10) {
        lastRenderTick = frameRef.current;
        setRenderTick(t => t + 1);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasSize, drawNewTrailsToBuffer, onComplete]);

  return (
    <div className="win-animation-overlay">
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        className="win-animation-canvas"
      />
    </div>
  );
}
