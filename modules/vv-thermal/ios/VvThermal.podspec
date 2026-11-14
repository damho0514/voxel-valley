Pod::Spec.new do |s|
  s.name           = 'VvThermal'
  s.version        = '1.0.0'
  s.summary        = 'Thermal state and Low Power Mode for Voxel Valley'
  s.description    = 'Reports ProcessInfo.thermalState and Low Power Mode, with change events, so the game can slow its frame rate before the phone gets hot.'
  s.license        = 'MIT'
  s.author         = 'damho0514'
  s.homepage       = 'https://github.com/damho0514/voxel-valley'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/damho0514/voxel-valley.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
end
