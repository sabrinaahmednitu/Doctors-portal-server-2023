const express = require('express');
const cors = require('cors');
const jwt = require("jsonwebtoken");
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

//nodemailer sendgrid 
//step -1
var nodemailer = require("nodemailer");
var sgTransport = require("nodemailer-sendgrid-transport");

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri =  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.d9sb2qq.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: 'UnAuthorizes access' });
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err){
      return res.status(403).send({message : 'Forbidden access'})
    }
    req.decoded = decoded;
    next();
  });
}


//emailer sendgrid
//booking email function
//step -2
const emailSenderOptions = {
  auth: {
    api_key: process.env.EMAIL_SENDER_KEY
  }
}

//step -3
const emailClient = nodemailer.createTransport(sgTransport(emailSenderOptions));

//step -4
function sendAppointmentEmail(booking) {
  const {patient ,patientName ,treatment ,date ,slot} = booking;

  
  //step -5
  var email = {
    from: process.env.EMAIL_SENDER,
    to: patient,
    subject: `Your Apppointment for ${treatment} is on ${date} at ${slot} is confirmed`,
    text: `Your Apppointment for ${treatment} is on ${date} at ${slot} is confirmed`,
    html: `
    <div>
    <p>Hello ${patientName}, </p>
    <h3>Your Appointment for ${treatment} is confirmed</h3>
    <p>Looking forward to seeing you on ${date} at ${slot} .</p>
    <h3>Our Address </h3>
    <p>sonadanga khhulna </p>
    <p>Bangladesh</p>
    <a href="https://web.programming-hero.com/">unsubscribe</a>
    </div>
    `
  };

  //step -6
  emailClient.sendMail(email, function (err, info) {
    if (err) {
      console.log(err);
    }
    else {
      console.log("Message sent : ", info);
    }
  });

}

//payment email function
function sendPaymentConformationEmail(booking) {
  const { patient, patientName, treatment, date, slot } = booking;

  //step -5
  var email = {
    from: process.env.EMAIL_SENDER,
    to: patient,
    subject: `We have received your payment for ${treatment} is on ${date} at ${slot} is confirmed`,
    text: `Your payment for this Apppointment ${treatment} is on ${date} at ${slot} is confirmed`,
    html: `
    <div>
    <p>Hello ${patientName}, </p>
    <h3>Thank you for your payment . </h3>
    <h3>We have received your payment</h3>
    <p>Looking forward to seeing you on ${date} at ${slot} .</p>
    <h3>Our Address </h3>
    <p>sonadanga khhulna </p>
    <p>Bangladesh</p>
    <a href="https://web.programming-hero.com/">unsubscribe</a>
    </div>
    `
  };

  //step -6
  emailClient.sendMail(email, function (err, info) {
    if (err) {
      console.log(err);
    } else {
      console.log("Message sent : ", info);
    }
  });
}

async function run() {
  try {
    await client.connect();
    const serviceCollection = client.db("doctors_portal2023").collection("services");
    const bookingCollection = client.db("doctors_portal2023").collection("bookings");
    const userCollection = client.db("doctors_portal2023").collection("users");
    const doctorCollection = client.db("doctors_portal2023").collection("doctors");
    const paymentCollection = client.db("doctors_portal2023").collection("payments");

    const verifyAdmin = async (req, res, next)=>{
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({email: requester});
      if (requesterAccount.role === "admin") {
        next();
      }
      else{
        res.status(403).send({ message: 'forbidden' });
      }
    }

    //payment api
    app.post("/create-payment-intent",verifyJWT, async (req, res) => {
      const service = req.body;
      const price = service.price;
      const amount = price*100;;
      
      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ['card']
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    //sob data dekhte pabo service er
    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });

    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });

    //admin select for all user dashboard
    app.put("/user/admin/:email", verifyJWT,verifyAdmin, async (req, res) => {
      const email = req.params.email;
        const filter = { email: email };
        const updateDoc = {
          $set: { role: "admin" },
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
  
    });

    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
      );
      res.send({ result, token });
    });

    //all users of dashboard
    app.get("/user", verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    //this is not the proper way to query
    //deep learning of mongodb use aggragate lookup ,pipeline ,match ,group
    app.get("/available", async (req, res) => {
      const date = req.query.date;

      //step 1 :get all services
      const services = await serviceCollection.find().toArray();

      //stepp 2 : get the booking of that day
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();

      //step 3: for each service ,find bookings for the service
      services.forEach((service) => {
        //step:4 find bookings for the service .output :[{},{},{}]
        const serviceBookings = bookings.filter(
          (book) => book.treatment === service.name
        );
        //step 5: select sllots for the service bookings :['','','','']
        const bookedSlots = serviceBookings.map((book) => book.slot);
        //step :6 select those slots that are not in bookedSlots
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        //ste 7 : set available to slots to make it easier
        service.slots = available;
      });

      res.send(services);
    });

    //dashboard e booking jabe ai api dea
    app.get("/booking", verifyJWT, async(req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const query = { patient: patient };
        const bookings = await bookingCollection.find(query).toArray();
        return res.send(bookings);
      } else {
        return res.status(403).send({ message: "forbidden access" });
      }
    });

    

    // modal e dawa information gulo database e chole asbe
    app.post("/booking", async(req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };
      const exists = await bookingCollection.findOne(query);
      if (exists) {
        return res.send({ success: false, booking: exists });
      }
      const result = await bookingCollection.insertOne(booking);
      //step-7
      console.log('sending email')
       sendAppointmentEmail(booking);
      return res.send({ success: true, result });
    });


    app.patch("/booking/:id",verifyJWT, async(req, res) => {
      const id = req.params.id;
      const payment = req.body;
      const filter = { _id: ObjectId(id) };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId
        }
      }
       const result = await paymentCollection.insertOne(payment);
      const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc);
      res.send(updatedDoc);
    })

    app.get('/booking/:id', verifyJWT, async(req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const booking = await bookingCollection.findOne(query);
      res.send(booking);
    });


    //show doctor api on managedoctors
    app.get('/doctor', verifyJWT,verifyAdmin, async (req, res) => {
      const doctors = await doctorCollection.find().toArray();
      res.send(doctors);
    })

    //doctor api
    app.post('/doctor', verifyJWT , verifyAdmin , async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    })

    //doctor delete api
    app.delete('/doctor/:email', verifyJWT , verifyAdmin , async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const result = await doctorCollection.deleteOne(filter);
      res.send(result);
    })


  }

  finally {
   
  }

}

run().catch(console.dir);
//1232523etd3d5ged3t5gde34t

app.get('/', (req, res) => {
  res.send('Hello doctor uncle')
})

app.listen(port, () => {
  console.log(`doctors app listening on port ${port}`)
})