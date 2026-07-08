var mongoose = require('mongoose');
var bcrypt = require('bcryptjs');
var Schema = mongoose.Schema;

var userSchema = new Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function(plain) {
  return bcrypt.compare(plain, this.password);
};

var User = mongoose.model('User', userSchema);

// Auto-seed a default dev user if none exists
async function seedDevUser() {
  try {
    var count = await User.countDocuments({});
    if (count === 0) {
      var admin = new User({ username: 'admin', password: 'admin123' });
      await admin.save();
      console.log('Dev user seeded — username: admin  password: admin123');
    }
  } catch (e) {
    // ignore seed errors (e.g. already exists)
  }
}

module.exports = { User, seedDevUser };
