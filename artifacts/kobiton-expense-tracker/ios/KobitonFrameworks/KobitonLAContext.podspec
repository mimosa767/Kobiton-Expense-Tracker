Pod::Spec.new do |s|
  s.name               = 'KobitonLAContext'
  s.version            = '1.0.0'
  s.summary            = 'Kobiton biometric interception framework'
  s.description        = 'Drop-in LAContext replacement enabling Kobiton biometric injection'
  s.homepage           = 'https://kobiton.com'
  s.license            = { :type => 'Commercial' }
  s.author             = { 'Kobiton' => 'support@kobiton.com' }
  s.platform           = :ios, '12.0'
  s.source             = { :git => '' }
  s.vendored_frameworks = 'KobitonLAContext.framework'
end