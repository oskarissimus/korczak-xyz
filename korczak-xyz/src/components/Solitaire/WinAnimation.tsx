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

interface TrailCard {
  card: Card;
  x: number;
  y: number;
  id: string;
}

// Physics constants
const GRAVITY = 0.3;
const BOUNCE_DAMPEN = 0.85; // Higher = more bounces
const TRAIL_INTERVAL = 2; // Add trail card every N frames (more frequent = denser trails)
const LAUNCH_INTERVAL = 4; // frames between card launches
const CARD_WIDTH = 70;
const CARD_HEIGHT = 100;
const MAX_FRAMES = 800; // Safety limit: ~13 seconds at 60fps

function CascadeCard({ card, x, y, opacity = 1 }: { card: Card; x: number; y: number; opacity?: number }) {
  const suitSymbol = SUIT_SYMBOLS[card.suit];
  const suitColor = SUIT_COLORS[card.suit];

  return (
    <div
      className={`cascade-card ${suitColor}`}
      style={{
        left: x,
        top: y,
        opacity,
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
  const [trailCards, setTrailCards] = useState<TrailCard[]>([]);
  const frameRef = useRef(0);
  const trailIdRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const pendingTrailCards = useRef<TrailCard[]>([]);

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
    if (animatedCards.length === 0) return;

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const { width: cardWidth, height: cardHeight } = getCardDimensions();

    const animate = () => {
      frameRef.current++;

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

          // Add to persistent trail every few frames
          if (frameRef.current % TRAIL_INTERVAL === 0) {
            pendingTrailCards.current.push({
              card: card.card,
              x: card.x,
              y: card.y,
              id: `trail-${trailIdRef.current++}`,
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

      // Add pending trail cards to state (outside of setAnimatedCards)
      if (pendingTrailCards.current.length > 0) {
        const cardsToAdd = [...pendingTrailCards.current];
        pendingTrailCards.current = [];
        setTrailCards(prev => [...prev, ...cardsToAdd]);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [animatedCards.length, getCardDimensions, onComplete]);

  return (
    <div className="win-animation-overlay">
      {/* Render persistent trail cards */}
      {trailCards.map((trailCard) => (
        <CascadeCard
          key={trailCard.id}
          card={trailCard.card}
          x={trailCard.x}
          y={trailCard.y}
        />
      ))}
      {/* Render active moving cards on top */}
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
