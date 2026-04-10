Pod::Spec.new do |s|
  s.name               = 'KobitonSdk'
  s.version            = '1.0.0'
  s.summary            = 'Kobiton image injection SDK'
  s.description        = 'Kobiton camera image injection framework for iOS'
  s.homepage           = 'https://kobiton.com'
  s.license            = { :type => 'Commercial' }
  s.author             = { 'Kobiton' => 'support@kobiton.com' }
  s.platform           = :ios, '12.0'
  s.source             = { :git => '' }
  s.vendored_frameworks = 'KobitonSdk.framework'
end