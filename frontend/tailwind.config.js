export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        void: '#0a0a0f',
        reactor: '#00d4ff',
        warning: '#ff3d3d',
        panel: '#11151f'
      },
      fontFamily: {
        hud: ['Inter', 'Segoe UI', 'Arial', 'sans-serif']
      },
      boxShadow: {
        reactor: '0 0 28px rgba(0, 212, 255, 0.45)',
        alert: '0 0 24px rgba(255, 61, 61, 0.38)'
      }
    }
  },
  plugins: []
};
