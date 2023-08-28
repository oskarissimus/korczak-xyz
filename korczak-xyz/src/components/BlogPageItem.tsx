import { GatsbyImage, IGatsbyImageData, getImage } from 'gatsby-plugin-image';
import React from 'react';

export interface BlogPost {
  excerpt: string | null;
  frontmatter: {
    slug: string | null;
    title: string | null;
    date: string | null;
    featuredImage: {
      childImageSharp: {
        gatsbyImageData: IGatsbyImageData | null;
      } | null;
    } | null;
  } | null;
}

export function formatDate(date: string | null): string {
  const d = new Date(date || 0);
  return d.toLocaleDateString();
}

export const BlogPageItem: React.FC<BlogPost> = ({ excerpt, frontmatter }) => {
  if (!frontmatter) return null;
  const { slug, title, date, featuredImage } = frontmatter;
  const imageData = featuredImage?.childImageSharp?.gatsbyImageData || null;
  const image = getImage(imageData);
  return (
    <li className='flex flex-col items-start gap-2'>
      <h2 className='text-2xl font-bold'>
        <a href={slug || undefined}>{title}</a>
      </h2>
      <div className='flex flex-row items-center gap-2'>
        {image && (
          <GatsbyImage image={image} alt={title || "Post's featured image"} />
        )}
        <p>{excerpt}</p>
      </div>
      <hr className='w-full border-1 border-gray-500' />
      <span>{formatDate(date)}</span>
    </li>
  );
};
