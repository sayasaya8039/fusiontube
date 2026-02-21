module.exports = {
  appId: 'com.fusiontube.app',
  productName: 'FusionTube',
  directories: { buildResources: 'resources', output: 'dist' },
  files: ['out/**/*'],
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] }
    ],
    icon: 'resources/icon.ico'
  },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  extraResources: [
    { from: 'resources/yt-dlp.exe', to: 'yt-dlp.exe' },
    { from: 'resources/ffmpeg.exe', to: 'ffmpeg.exe' },
    { from: 'resources/bin/aria2c.exe', to: 'bin/aria2c.exe' }
  ],
  publish: [
    {
      provider: 'github',
      owner: 'YOUR_GITHUB_USERNAME',
      repo: 'fusiontube'
    }
  ]
}
