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
  active: boolean;
  launched: boolean;
}

// Trail stored as simple data, not React components
interface TrailData {
  x: number;
  y: number;
  suit: string;
  rank: string;
  color: string;
}

// Physics constants
const GRAVITY = 0.3;
const BOUNCE_DAMPEN = 0.85; // Higher = more bounces
const TRAIL_INTERVAL = 2; // Add trail card every N frames (more frequent = denser trails)
const LAUNCH_INTERVAL = 4; // frames between card launches
const CARD_WIDTH = 70;
const CARD_HEIGHT = 100;
const MAX_FRAMES = 800; // Safety limit: ~13 seconds at 60fps

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

function CascadeCard({ card, x, y }: { card: Card; x: number; y: number }) {
  const suitSymbol = SUIT_SYMBOLS[card.suit];
  const suitColor = SUIT_COLORS[card.suit];

  return (
    <div
      className={`cascade-card ${suitColor}`}
      style={{
        left: x,
        top: y,
      }}
    >
      <div className="card-corner top-left">
        <span className="card-rank">{card.rank}</span>
        <span className="card-suit">{suitSymbol}</span>
      </div>
      <div className="card-center">
        <span className="card-suit-large">{suitSymbol}</span>
      </div>
      <div className="card-corner bottom-right">
        <span className="card-rank">{card.rank}</span>
        <span className="card-suit">{suitSymbol}</span>
      </div>
    </div>
  );
}

export function WinAnimation({ foundations, onComplete }: WinAnimationProps) {
  const [animatedCards, setAnimatedCards] = useState<AnimatedCard[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailsRef = useRef<TrailData[]>([]); // Trails stored in ref, not state!
  const frameRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const completedRef = useRef(false);

  // Get responsive card dimensions
  const getCardDimensions = useCallback(() => {
    const width = window.innerWidth;
    if (width <= 600) {
      return { width: 42, height: 60 };
    } else if (width <= 900) {
      return { width: 55, height: 80 };
    }
    return { width: CARD_WIDTH, height: CARD_HEIGHT };
  }, []);

  // Initialize canvas size
  useEffect(() => {
    const updateCanvasSize = () => {
      setCanvasSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, []);

  // Draw trails on canvas
  const drawTrails = useCallback((ctx: CanvasRenderingContext2D) => {
    const trails = trailsRef.current;
    const { width: cardW, height: cardH } = getCardDimensions();
    const textColor = (color: string) => color === 'red' ? '#c00000' : '#000000';

    for (const trail of trails) {
      // Draw card background with border
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, trail.x, trail.y, cardW, cardH, 4);
      ctx.fill();

      // Draw border (outset effect)
      ctx.strokeStyle = '#dfdfdf';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = textColor(trail.color);

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
    }
  }, [getCardDimensions]);

  // Initialize cards from foundations
  useEffect(() => {
    const screenWidth = window.innerWidth;
    const { width: cardWidth } = getCardDimensions();

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

    // Create animated card objects
    const cards: AnimatedCard[] = allCards.map(({ card, foundationIndex }, index) => {
      // Alternate direction and randomize velocity
      const goRight = index % 2 === 0;
      const baseVx = 2 + Math.random() * 3; // 2-5 px/frame (slower = more visible trails)

      return {
        card,
        x: startX + foundationIndex * (cardWidth + 10),
        y: startY,
        vx: goRight ? baseVx : -baseVx,
        vy: -1 - Math.random() * 2, // Gentler initial upward velocity
        active: true,
        launched: false,
      };
    });

    setAnimatedCards(cards);
  }, [foundations, getCardDimensions]);

  // Animation loop
  useEffect(() => {
    if (animatedCards.length === 0 || canvasSize.width === 0) return;

    const screenWidth = canvasSize.width;
    const screenHeight = canvasSize.height;
    const { width: cardWidth, height: cardHeight } = getCardDimensions();

    const animate = () => {
      frameRef.current++;

      // Get canvas context and clear/redraw trails
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawTrails(ctx);
      }

      setAnimatedCards(prevCards => {
        const newCards = prevCards.map((card, index) => {
          // Launch cards one at a time
          if (!card.launched) {
            if (frameRef.current >= index * LAUNCH_INTERVAL) {
              return { ...card, launched: true };
            }
            return card;
          }

          if (!card.active) return card;

          // Add to persistent trail every few frames (stored in ref, no re-render!)
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
          let newVy = card.vy + GRAVITY;
          let newX = card.x + card.vx;
          let newY = card.y + newVy;

          // Bounce off bottom
          if (newY > screenHeight - cardHeight) {
            newY = screenHeight - cardHeight;
            newVy = -Math.abs(newVy) * BOUNCE_DAMPEN;
          }

          // Bounce off sides (keeps cards on screen longer, creating more visible trails)
          if (newX < 0) {
            newX = 0;
            card.vx = Math.abs(card.vx) * 0.9;
          } else if (newX > screenWidth - cardWidth) {
            newX = screenWidth - cardWidth;
            card.vx = -Math.abs(card.vx) * 0.9;
          }

          // Check if card energy is depleted (very slow movement at bottom)
          const totalEnergy = Math.abs(card.vx) + Math.abs(newVy);
          const atBottom = newY >= screenHeight - cardHeight - 10;
          const isExhausted = totalEnergy < 2 && atBottom;

          return {
            ...card,
            x: newX,
            y: newY,
            vy: newVy,
            active: !isExhausted,
          };
        });

        // Check if animation is complete
        const allLaunched = newCards.every(c => c.launched);
        const allInactive = newCards.every(c => !c.active);
        const maxFramesReached = frameRef.current >= MAX_FRAMES;

        if ((allLaunched && allInactive || maxFramesReached) && !completedRef.current) {
          completedRef.current = true;
          setTimeout(() => {
            onComplete();
          }, 300);
        }

        return newCards;
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [animatedCards.length, canvasSize, getCardDimensions, drawTrails, onComplete]);

  return (
    <div className="win-animation-overlay">
      {/* Canvas for trail cards (performant!) */}
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        className="win-animation-canvas"
      />
      {/* Render only active moving cards as React components */}
      {animatedCards.map((animCard) => {
        if (!animCard.launched || !animCard.active) return null;

        return (
          <CascadeCard
            key={`active-${animCard.card.id}`}
            card={animCard.card}
            x={animCard.x}
            y={animCard.y}
          />
        );
      })}
    </div>
  );
}
