# One-time, interactive: lets EAS create the App Store distribution certificate and
# provisioning profile, authenticating to Apple with an App Store Connect API key
# instead of an Apple ID login. Expects the key in the environment:
#   $env:EXPO_ASC_API_KEY_PATH = 'C:\path\to\AuthKey_XXXXXXXXXX.p8'
#   $env:EXPO_ASC_KEY_ID       = 'XXXXXXXXXX'
#   $env:EXPO_ASC_ISSUER_ID    = '<issuer uuid from App Store Connect > Users and Access > Integrations>'
# Answer "Y" to both "Generate a new ..." prompts. Afterwards `eas build --profile production`
# and `eas submit` (with the same three variables set) run fully non-interactively.

foreach ($name in 'EXPO_ASC_API_KEY_PATH', 'EXPO_ASC_KEY_ID', 'EXPO_ASC_ISSUER_ID') {
  if (-not (Get-Item "env:$name" -ErrorAction SilentlyContinue)) {
    Write-Error "Set $name first (see the header of this script)."
    exit 1
  }
}

$env:EXPO_APPLE_TEAM_ID = 'HUMYFK99PK'
$env:EXPO_APPLE_TEAM_TYPE = 'INDIVIDUAL'

Set-Location $PSScriptRoot\..
npx eas-cli credentials:configure-build -p ios -e production
