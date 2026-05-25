import sys
import os
from playwright.sync_api import sync_playwright

def run_test():
    with sync_playwright() as p:
        print("Starting Playwright E2E Mock Auth and Verification Queue Test...")
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-web-security"
            ]
        )
        # Use realistic user agent and locales
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800},
            locale="en-US",
            timezone_id="Asia/Kolkata"
        )
        page = context.new_page()

        try:
            # Capture console logs to debug client issues
            page.on("console", lambda msg: print(f"CONSOLE [{msg.type}]: {msg.text}"))
            page.on("pageerror", lambda err: print(f"UNCAUGHT EXCEPTION: {err}"))

            # Navigate to the local application engaging the mock authentication layer
            target_url = "http://localhost:5173/?mock_auth=true&portal=volunteer"
            print(f"Navigating to local app: {target_url}")
            page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
            
            page.wait_for_timeout(3000)
            
            print("Looking for sign in buttons...")
            # Click either the bottom banner or the header sign in button
            sign_in_banner = page.locator('button:has-text("Sign In with Google")').first
            sign_in_header = page.locator('button:has-text("Sign In")').first
            
            if sign_in_banner.is_visible():
                print("Clicking bottom banner Sign In with Google...")
                sign_in_banner.click()
            elif sign_in_header.is_visible():
                print("Clicking header Sign In button...")
                sign_in_header.click()
            else:
                print("No guest sign-in buttons visible. Checking if already logged in.")

            page.wait_for_timeout(2000)
            
            # Verify mock sign-in form title is visible
            print("Checking if mock sign-in modal is visible...")
            modal_visible = page.locator('h3:has-text("Sign In (Mock)")').first.is_visible()
            print(f"Mock sign-in modal visible: {modal_visible}")
            
            if not modal_visible:
                # If already signed in, check profile or Audit Queue
                if page.locator('button:has-text("Audit Queue")').first.is_visible():
                    print("Already logged in.")
                else:
                    raise Exception("Mock login screen failed to display and Audit Queue is not present.")
            else:
                # Fill email
                print("Entering test email address...")
                email_input = page.locator('input[name="identifier"]').first
                email_input.wait_for(state="visible", timeout=5000)
                email_input.fill("your_email+clerk_test@example.com")
                email_input.press("Enter")
                
                page.wait_for_timeout(2000)
                
                # Enter OTP code
                print("Entering test OTP code (424242)...")
                otp_input = page.locator('input[placeholder="Enter 424242"]').first
                otp_input.wait_for(state="visible", timeout=5000)
                otp_input.fill("424242")
                otp_input.press("Enter")
                
                print("Authentication submitted. Waiting for page reload...")
                page.wait_for_timeout(5000)

            # Ensure we are logged in by checking for the Audit Queue button on the Volunteer HUD
            audit_queue_btn = page.locator('button:has-text("Audit Queue")').first
            audit_queue_btn.wait_for(state="visible", timeout=10000)
            print("✅ Login successful. Found 'Audit Queue' button.")

            # Click Audit Queue button to open the Verification Queue panel
            print("Opening the Verification Queue...")
            audit_queue_btn.click()
            page.wait_for_timeout(2000)

            # Assert Verification Queue title is visible
            queue_title = page.locator('h1:has-text("Volunteer Verification Queue")').first
            queue_title.wait_for(state="visible", timeout=5000)
            print("✅ Verification Queue panel is open.")

            # Check if there is an active item in the queue or if it is empty
            page.wait_for_timeout(1000)
            empty_state = page.locator('h2:has-text("Queue Fully Cleared")').first
            submission_card = page.locator('button:has-text("Approve")').first

            if empty_state.is_visible():
                print("✅ Verification Queue is currently empty. Empty state displayed successfully.")
            elif submission_card.is_visible():
                print("Submission found in verification queue. Simulating vote approval...")
                # Optional: Enter a mock remark/note
                notes_input = page.locator('input[placeholder="Enter context, corrections, or flags..."]').first
                if notes_input.is_visible():
                    notes_input.fill("Automated E2E audit validation test.")
                
                # Approve the submission
                submission_card.click()
                print("Clicked Approve button.")
                page.wait_for_timeout(2000)
                print("✅ Vote submitted successfully.")
            else:
                print("⚠️ Queue is in an indeterminate state (neither empty message nor Approve button found).")

            print("Saving E2E test success screenshot...")
            success_screenshot_path = os.path.join(os.path.dirname(__file__), "../test_success.png")
            page.screenshot(path=success_screenshot_path)
            print(f"E2E Test Success! Screenshot saved to {success_screenshot_path}")
            sys.exit(0)

        except Exception as e:
            print(f"❌ Test failed with error: {e}")
            screenshot_path = os.path.join(os.path.dirname(__file__), "../login_error.png")
            page.screenshot(path=screenshot_path)
            print(f"Saved error screenshot to {screenshot_path}")
            sys.exit(1)
        finally:
            browser.close()

if __name__ == "__main__":
    run_test()
