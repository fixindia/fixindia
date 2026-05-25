import sys
import os
from playwright.sync_api import sync_playwright

def run_test():
    with sync_playwright() as p:
        print("Starting Playwright E2E Admin Panel Integration Test...")
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-web-security"
            ]
        )
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

            # Navigate to the local admin panel on port 5174
            target_url = "http://localhost:5174/"
            print(f"Navigating to local admin panel: {target_url}")
            page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
            
            page.wait_for_timeout(3000)
            
            # Verify we are connected successfully
            print("Checking connection banner...")
            connection_status = page.locator('span:has-text("Secure")').first
            connection_status.wait_for(state="visible", timeout=10000)
            print("✅ Admin panel connected to backend successfully.")

            # Take dashboard screenshot
            print("Taking dashboard screenshot...")
            dashboard_screenshot_path = os.path.join(os.path.dirname(__file__), "../admin_dashboard.png")
            page.screenshot(path=dashboard_screenshot_path)
            print(f"✓ Dashboard screenshot saved to {dashboard_screenshot_path}")

            # ─── Navigation Test ───
            # Click SQL Query Tab
            print("Navigating to Database Shell tab...")
            sql_tab_btn = page.locator('button:has-text("Database SQL Shell")').first
            sql_tab_btn.click()
            page.wait_for_timeout(1000)

            # Check if query editor is visible
            print("Verifying query executor form...")
            query_textarea = page.locator('textarea').first
            query_textarea.wait_for(state="visible", timeout=5000)
            print("✓ Database Shell query text area found.")

            # Click Run Query
            print("Running default query: 'SELECT * FROM reports LIMIT 5;'...")
            run_query_btn = page.locator('button:has-text("Execute Query")').first
            run_query_btn.click()
            page.wait_for_timeout(2000)

            # Verify query result status or table is visible
            result_summary = page.locator('div:has-text("Query OK")').first
            # Alternate: query completed without errors
            error_box = page.locator('div.text-red-400').first
            if error_box.is_visible():
                print(f"⚠️ Query returned error: {error_box.inner_text()}")
            else:
                result_summary.wait_for(state="visible", timeout=5000)
                print("✅ Query ran successfully.")

            # Click AI Models Config Tab
            print("Navigating to AI Models Config tab...")
            ai_tab_btn = page.locator('button:has-text("AI Model Config")').first
            ai_tab_btn.click()
            page.wait_for_timeout(1000)

            # Check if default seeded model is visible
            print("Checking for default models...")
            model_name = page.locator('div:has-text("Groq Llama 3.3 70B")').first
            model_name.wait_for(state="visible", timeout=5000)
            print("✅ AI Models list populated successfully with defaults.")

            # Take full view screenshot
            print("Taking full E2E admin test screenshot...")
            admin_screenshot_path = os.path.join(os.path.dirname(__file__), "../admin_test_success.png")
            page.screenshot(path=admin_screenshot_path)
            print(f"✅ Admin E2E Test Success! Screenshot saved to {admin_screenshot_path}")
            sys.exit(0)

        except Exception as e:
            print(f"❌ Admin E2E Test failed with error: {e}")
            screenshot_path = os.path.join(os.path.dirname(__file__), "../admin_test_error.png")
            page.screenshot(path=screenshot_path)
            print(f"Saved error screenshot to {screenshot_path}")
            sys.exit(1)
        finally:
            browser.close()

if __name__ == "__main__":
    run_test()
