export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        display: ["Poppins", "sans-serif"]
      },
      colors: {
        skybrand: "#00c6ff",
        bluebrand: "#0072ff",
        ink: "#050505",
        forestbrand: "#0f3d2e",
        neonbrand: "#38ff88"
      },
      boxShadow: {
        float: "0 18px 45px rgba(22, 41, 82, 0.12)"
      }
    }
  },
  plugins: []
};
