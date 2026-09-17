Pod::Spec.new do |s|
  s.name           = 'VlcPlayer'
  s.version        = '1.0.0'
  s.summary        = 'MobileVLCKit-backed RTSP player view for Camera Hub'
  s.description    = 'Plays RTSP streams from IP cameras through libVLC, exposed as an Expo module view.'
  s.author         = 'Gabriel Camara'
  s.homepage       = 'https://gcamara.dev'
  s.license        = { type: 'MIT' }
  s.platforms      = { ios: '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.dependency 'MobileVLCKit', '~> 3.7.3'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
