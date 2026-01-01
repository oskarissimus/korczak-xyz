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
  trail: { x: number; y: number }[];
  active: boolean;
  launched: boolean;
}

// Physics constants
const GRAVITY = 0.4;
const BOUNCE_DAMPEN = 0.75;
const MAX_TRAIL = 10;
const LAUNCH_INTERVAL = 3; // frames between card launches
const CARD_WIDTH = 70;
const CARD_HEIGHT = 100;

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
      const baseVx = 4 + Math.random() * 4; // 4-8 px/frame

      return {
        card,
        x: startX + foundationIndex * (cardWidth + 10),
        y: startY,
        vx: goRight ? baseVx : -baseVx,
        vy: -2 - Math.random() * 3, // Initial upward velocity
        trail: [],
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

          // Update physics
          let newVy = card.vy + GRAVITY;
          let newX = card.x + card.vx;
          let newY = card.y + newVy;

          // Bounce off bottom
          if (newY > screenHeight - cardHeight) {
            newY = screenHeight - cardHeight;
            newVy = -Math.abs(newVy) * BOUNCE_DAMPEN;
          }

          // Add to trail
          const newTrail = [...card.trail, { x: card.x, y: card.y }];
          if (newTrail.length > MAX_TRAIL) {
            newTrail.shift();
          }

          // Check if card is off-screen
          const isOffScreen = newX < -cardWidth - 20 || newX > screenWidth + cardWidth + 20;

          return {
            ...card,
            x: newX,
            y: newY,
            vy: newVy,
            trail: newTrail,
            active: !isOffScreen,
          };
        });

        // Check if animation is complete
        const allLaunched = newCards.every(c => c.launched);
        const allInactive = newCards.every(c => !c.active);

        if (allLaunched && allInactive && !completedRef.current) {
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
  }, [animatedCards.length, getCardDimensions, onComplete]);

  return (
    <div className="win-animation-overlay">
      {animatedCards.map((animCard, cardIndex) => {
        if (!animCard.launched) return null;

        return (
          <React.Fragment key={animCard.card.id}>
            {/* Render trail cards (older = more transparent) */}
            {animCard.trail.map((pos, trailIndex) => (
              <CascadeCard
                key={`${animCard.card.id}-trail-${trailIndex}`}
                card={animCard.card}
                x={pos.x}
                y={pos.y}
                opacity={0.1 + (trailIndex / MAX_TRAIL) * 0.5}
              />
            ))}
            {/* Render main card */}
            {animCard.active && (
              <CascadeCard
                card={animCard.card}
                x={animCard.x}
                y={animCard.y}
                opacity={1}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
