# Orion AutoDev - GitHub Setup Script
# Run this after creating the GitHub repository

# Replace YOUR_GITHUB_USERNAME with your actual GitHub username
$GITHUB_USERNAME = "YOUR_GITHUB_USERNAME"
$REPO_URL = "https://github.com/$GITHUB_USERNAME/orion-autodev.git"

Write-Host "🚀 Pushing to GitHub..." -ForegroundColor Cyan

cd C:\Users\Private\Documents\orion-autodev

# Set remote
git remote add origin $REPO_URL

# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main

Write-Host "✅ Repository successfully pushed to GitHub!" -ForegroundColor Green
Write-Host "📍 View at: https://github.com/$GITHUB_USERNAME/orion-autodev" -ForegroundColor Yellow
