import React from 'react';

export default function Youtube({ videoId }: { videoId: string }) {
  return (
    <iframe
      width='560'
      height='315'
      src={`https://www.youtube.com/embed/${videoId}`}
      title='YouTube video player'
      frameBorder='0'
      allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
      referrerPolicy='strict-origin-when-cross-origin'
      allowFullScreen
    ></iframe>
  );
}
