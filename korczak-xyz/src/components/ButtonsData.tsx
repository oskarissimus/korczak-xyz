import { solid, brands, regular } from '@fortawesome/fontawesome-svg-core/import.macro';

interface Button {
  icon: any;
  text: string;
  backgroundColor: string;
  to: string;
}

export const buttons: Button[] = [
  {
    icon: brands("discord"),
    text: "Discord community",
    backgroundColor: "bg-[#7289d9]",
    to: "https://discord.gg/DwbvwjJM7N"
  },
  {
    icon: brands("youtube"),
    text: "Youtube channel",
    backgroundColor: "bg-[#ff0000]",
    to: "https://www.youtube.com/@korczakxyz"
  },
  {
    icon: solid("laptop-code"),
    text: "Courses",
    backgroundColor: "bg-[#a4036f]",
    to: "/courses"
  },
  {
    icon: regular("lightbulb"),
    text: "Mentoring",
    backgroundColor: "bg-[#048ba8]",
    to: "/mentoring"
  },
  {
    icon: regular("list-alt"),
    text: "Blog",
    backgroundColor: "bg-[#87420D]",
    to: "/blog"
  },
  {
    icon: brands("github"),
    text: "Github",
    backgroundColor: "bg-[#333]",
    to: "https://github.com/oskarissimus"
  },
];
