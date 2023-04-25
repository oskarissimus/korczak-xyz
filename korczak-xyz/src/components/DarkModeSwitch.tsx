import React, { useContext } from 'react';
import ThemeContext from '../context/ThemeContext';

interface DarkModeSwitchProps {
    className?: string;
}

const DarkModeSwitch: React.FC<DarkModeSwitchProps> = ({ className }) => {
    const { theme, setTheme } = useContext(ThemeContext);

    const toggleTheme = () => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
    };

    return (
        <label className={className}>
            <input
                type="checkbox"
                className="sr-only peer"
                onChange={toggleTheme}
                checked={theme === 'dark'}
            />
            <div className="
        mx-[-20px]
        w-[105px]
        h-[56px]
        bg-gray-200
        rounded-full
        text-center
        leading-[40px]
        text-[36px]
        scale-[0.5]

        peer-checked:bg-gray-400

        peer-checked:after:border-gray-900
        peer-checked:after:translate-x-full
        peer-checked:after:text-white
        peer-checked:after:bg-gray-700

        after:content-['☼']
        after:absolute
        after:top-[4px]
        after:left-[4px]
        after:bg-white
        after:border-gray-300
        after:border
        after:rounded-full
        after:h-12
        after:w-12
        after:transition-all

        dark:after:content-['☾']
        dark:after:text-gray-700
        dark:bg-gray-700
        dark:peer-focus:ring-blue-800
        dark:border-gray-600
        ">
            </div>
            <span className="sr-only">Dark mode</span>
        </label>
    );
};

export default DarkModeSwitch;