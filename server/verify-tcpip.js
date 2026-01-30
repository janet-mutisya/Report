// test-final-email.js
const { testSMTPConnection, sendSimpleEmail } = require('./server/service/emailService.js');

async function testFinalEmailSystem() {
  console.log('🧪 FINAL EMAIL SYSTEM TEST...\n');
  
  try {
    // Test 1: SMTP Connection
    console.log('1. Testing SMTP connection...');
    const smtpSuccess = await testSMTPConnection();
    
    if (!smtpSuccess) {
      console.log('❌ SMTP test failed - stopping test');
      return;
    }
    
    // Test 2: Send Simple Email
    console.log('\n2. Testing email sending...');
    const testResult = await sendSimpleEmail({
      to: process.env.TEST_EMAIL || 'jmutisya@bmsecurity.com',
      subject: '🎉 FINAL TEST - BM Security Email System',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #2c5aa0;">✅ BM Security Email System - OPERATIONAL</h2>
          <p><strong>Status:</strong> System is fully functional</p>
          <p><strong>Sender:</strong> leavemanagement@bmsecurity.com</p>
          <p><strong>SMTP Provider:</strong> Gmail with App Password</p>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
          <p>Your automated reporting system is now ready for client use! 🚀</p>
        </div>
      `
    });
    
    console.log('✅ Email sent successfully!');
    console.log('📧 Message ID:', testResult.messageId);
    console.log('\n🎉 YOUR EMAIL SYSTEM IS FULLY OPERATIONAL!');
    console.log('📝 All reports will now be sent from: leavemanagement@bmsecurity.com');
    
  } catch (error) {
    console.error('❌ Final test failed:', error.message);
  }
}

testFinalEmailSystem();