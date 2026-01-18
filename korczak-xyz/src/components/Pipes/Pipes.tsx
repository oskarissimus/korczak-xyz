import React, { useRef, useEffect, useState, useCallback } from 'react';
import { PipeScene } from './PipeScene';

interface PipesProps {
  lang: 'en' | 'pl';
}

const translations = {
  en: {
    pause: 'Pause',
    play: 'Play',
    reset: 'Reset',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit Fullscreen',
  },
  pl: {
    pause: 'Pauza',
    play: 'Graj',
    reset: 'Reset',
    fullscreen: 'Pełny ekran',
    exitFullscreen: 'Zamknij',
  },
};

export default function Pipes({ lang }: PipesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PipeScene | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const t = translations[lang];

  // Initialize scene
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new PipeScene(canvas);
    sceneRef.current = scene;

    // Initial size
    const container = containerRef.current;
    if (container) {
      scene.resize(container.clientWidth, container.clientHeight);
    }

    scene.start();

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const scene = sceneRef.current;
      if (container && scene) {
        scene.resize(container.clientWidth, container.clientHeight);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      // Resize after fullscreen change
      setTimeout(() => {
        const container = containerRef.current;
        const scene = sceneRef.current;
        if (container && scene) {
          scene.resize(container.clientWidth, container.clientHeight);
        }
      }, 100);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handlePausePlay = useCallback(() => {
    const scene = sceneRef.current;
    if (scene) {
      const paused = scene.togglePause();
      setIsPaused(paused);
    }
  }, []);

  const handleReset = useCallback(() => {
    const scene = sceneRef.current;
    if (scene) {
      scene.reset();
    }
  }, []);

  const handleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch((err) => {
        console.error('Fullscreen error:', err);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  return (
    <div className="pipes-container" ref={containerRef}>
      <canvas ref={canvasRef} className="pipes-canvas" />
      <div className="pipes-controls">
        <button
          className="win95-button pipes-btn"
          onClick={handlePausePlay}
          title={isPaused ? t.play : t.pause}
        >
          {isPaused ? t.play : t.pause}
        </button>
        <button
          className="win95-button pipes-btn"
          onClick={handleReset}
          title={t.reset}
        >
          {t.reset}
        </button>
        <button
          className="win95-button pipes-btn"
          onClick={handleFullscreen}
          title={isFullscreen ? t.exitFullscreen : t.fullscreen}
        >
          {isFullscreen ? t.exitFullscreen : t.fullscreen}
        </button>
      </div>
    </div>
  );
}
