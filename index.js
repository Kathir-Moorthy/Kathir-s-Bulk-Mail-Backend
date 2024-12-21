const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const mongoose = require("mongoose");
const multer = require("multer");
const fs = require("fs");
const schedule = require("node-schedule"); // Ensure node-schedule is correctly imported
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

// Set up Multer for file uploads
const upload = multer({ dest: "uploads/" });

// MongoDB Connection
const mongoURI = `mongodb+srv://${process.env.MONGO_USERNAME}:${process.env.MONGO_PASSWORD}@cluster0.ogfb5.mongodb.net/passkey?retryWrites=true&w=majority&appName=Cluster0`;

// Connect to MongoDB
mongoose
  .connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("Connected to MongoDB");
  })
  .catch((error) => {
    console.error("Failed to connect to MongoDB:", error.message);
  });

// Credential Model
const credentialSchema = new mongoose.Schema(
  {
    user: String,
    pass: String,
  },
  { collection: "bulkmail" } // Use the existing "bulkmail" collection
);

const Credential = mongoose.model("Credential", credentialSchema);

// Global transporter variable
let transporter;

// Fetch credentials and initialize the transporter
const initializeTransporter = async () => {
  try {
    const data = await Credential.find();
    if (data.length === 0) {
      console.error("No credentials found in the database.");
      return;
    }

    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: data[0].user,
        pass: data[0].pass,
      },
    });
    console.log("Nodemailer transporter initialized.");
  } catch (error) {
    console.error("Error fetching credentials:", error.message);
  }
};

// Call this function on server start
initializeTransporter();

// Function to send emails
const sendEmails = async ({ msg, emailList, senderEmail, subject, attachmentFile }) => {
  const uniqueEmails = [...new Set(emailList)];

  for (const email of uniqueEmails) {
    const mailOptions = {
      from: `"${senderEmail}" <${transporter.options.auth.user}>`,
      replyTo: senderEmail,
      to: email,
      subject: subject,
      text: msg,
      ...(attachmentFile && { attachments: [attachmentFile] }),
    };

    await transporter.sendMail(mailOptions);
  }

  // Clean up the uploaded file
  if (attachmentFile && attachmentFile.path) {
    fs.unlinkSync(attachmentFile.path);
  }
};

// Async route to handle email sending with or without scheduling
app.post("/sendemail", upload.single("attachment"), async (req, res) => {
  const { msg, emailList, senderEmail, subject, schedule: isScheduled, scheduleDate, scheduleTime } = req.body;

  if (!msg || !emailList || emailList.length === 0 || !senderEmail || !subject) {
    return res.status(400).json({ success: false, message: "Required fields are missing." });
  }

  if (!transporter) {
    return res.status(500).json({ success: false, message: "Email transporter not initialized." });
  }

  try {
    const parsedEmailList = JSON.parse(emailList);

    const attachmentFile = req.file
      ? { filename: req.file.originalname, path: req.file.path }
      : null;

    if (isScheduled === "true" && scheduleDate && scheduleTime) {
      const scheduleDateTime = new Date(`${scheduleDate}T${scheduleTime}`);

      if (isNaN(scheduleDateTime.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid schedule date or time." });
      }

      schedule.scheduleJob(scheduleDateTime, async () => {
        try {
          await sendEmails({
            msg,
            emailList: parsedEmailList,
            senderEmail,
            subject,
            attachmentFile,
          });
          console.log("Scheduled emails sent successfully.");
        } catch (error) {
          console.error("Error sending scheduled emails:", error.message);
        }
      });

      console.log("Email scheduled successfully.");
      return res.json({ success: true, scheduled: true });
    } else {
      await sendEmails({
        msg,
        emailList: parsedEmailList,
        senderEmail,
        subject,
        attachmentFile,
      });
      console.log("Emails sent successfully.");
      return res.json({ success: true });
    }
  } catch (error) {
    console.error("Error processing request:", error.message);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
});

// Start the server
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});