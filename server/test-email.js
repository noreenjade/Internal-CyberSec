require("dotenv").config();
const { sendNotificationEmail } = require("./mailer");

const myEmail = process.env.SMTP_USER; // ipapadala sa sarili mong email

sendNotificationEmail(
  myEmail,
  "Test Email from CyberOps Ticketing",
  "Kung nabasa mo ito, gumagana na ang SMTP setup mo!"
).then((success) => {
  console.log("Email sent successfully:", success);
  process.exit(0);
});