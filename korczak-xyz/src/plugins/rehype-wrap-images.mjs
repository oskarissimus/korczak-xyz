import { visit } from 'unist-util-visit';

/**
 * Rehype plugin to wrap images in a span with class "image-frame"
 * This allows borders to be on the wrapper (unaffected by dither filter)
 * rather than on the img element itself.
 */
export default function rehypeWrapImages() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName === 'img' && parent && typeof index === 'number') {
        // Create wrapper span
        const wrapper = {
          type: 'element',
          tagName: 'span',
          properties: { className: ['image-frame'] },
          children: [node],
        };

        // Replace img with wrapper containing img
        parent.children[index] = wrapper;
      }
    });
  };
}
