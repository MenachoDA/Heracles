/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'brand-blue': '#38b6ff',
                'brand-yellow': '#ffde59',
            }
        },
    },
    plugins: [],
}